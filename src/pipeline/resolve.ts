// Resolution and enrichment orchestration.
//
// Phase 1  NS at each registrable domain (one query per registrable).
// Phase 2  For registered domains: A, AAAA, MX, TXT, a wildcard probe, and
//          registry RDAP. Unregistered candidates cost one query only.
// Phase 3  For each unique IP: RIR RDAP and (optionally) Abusix over DoH.
//
// Already-answered lookups are skipped, so re-running resumes a cancelled
// run and "retry blocked" only repeats lookups that were blocked.
import type { Collector } from '../collect/Collector';
import { decideVerdict } from '../core/resolve/verdict';
import { wildcardProbeName } from '../core/resolve/wildcard';
import { aRecords, aaaaRecords } from '../core/dns/doh';
import type { DnsAnswer, DomainRecord, LookupResult, RdapDomain, RRType } from '../core/types';
import { WILDCARD_PREFIX, dnsQuery, latest, worthEnriching } from './facts';

type AnyLookup = LookupResult<unknown>;

export interface ResolveProgress {
  phase: 'ns' | 'enrich' | 'network' | 'verify';
  done: number;
  total: number;
}

export interface ResolveOptions {
  signal?: AbortSignal;
  useAbusix: boolean;
  /** Re-run lookups whose latest result was blocked (except 'unsupported'). */
  retryBlocked?: boolean;
  /** Max IPs enriched per domain. */
  maxIpsPerDomain?: number;
  concurrency?: number;
  /** Called for every lookup with every domain it applies to. */
  onLookup: (domains: string[], result: AnyLookup) => void;
  onProgress?: (p: ResolveProgress) => void;
}

const settled = (l: AnyLookup | undefined, retryBlocked: boolean) =>
  !!l && (l.status !== 'blocked' || l.reason === 'unsupported' || (!retryBlocked && l.reason !== 'cancelled'));

async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      if (signal?.aborted) return;
      const item = items[i++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export async function resolveDomains(records: readonly DomainRecord[], collector: Collector, o: ResolveOptions): Promise<void> {
  const retry = !!o.retryBlocked;
  const conc = o.concurrency ?? 8;
  const active = records.filter((r) => !r.inventory);
  const callOpts = o.signal ? { signal: o.signal } : {};

  // Local view of lookups so later phases see results from earlier phases.
  const local = new Map<string, AnyLookup[]>(active.map((r) => [r.domain, [...r.lookups]]));
  const byRegistrable = new Map<string, DomainRecord[]>();
  for (const r of active) byRegistrable.set(r.registrable, [...(byRegistrable.get(r.registrable) ?? []), r]);

  const emit = (domains: string[], res: AnyLookup) => {
    for (const d of domains) local.get(d)?.push(res);
    o.onLookup(domains, res);
  };
  const latestFor = (domain: string, pred: (l: AnyLookup) => boolean) => latest(local.get(domain) ?? [], pred);

  // ── Phase 1: NS at the registrable domain ──
  const regs = [...byRegistrable.keys()].filter((reg) => {
    const first = byRegistrable.get(reg)![0]!;
    return !settled(latestFor(first.domain, (l) => l.kind === 'dns' && l.query === dnsQuery(reg, 'NS')), retry);
  });
  let done = 0;
  o.onProgress?.({ phase: 'ns', done, total: regs.length });
  await pool(
    regs,
    conc,
    async (reg) => {
      const res = await collector.dns(reg, 'NS', callOpts);
      emit(byRegistrable.get(reg)!.map((r) => r.domain), res);
      o.onProgress?.({ phase: 'ns', done: ++done, total: regs.length });
    },
    o.signal,
  );
  if (o.signal?.aborted) return;

  // ── Phase 2: enrich registered domains ──
  const verdictOf = (r: DomainRecord) => {
    const ns = latestFor(r.domain, (l) => l.kind === 'dns' && l.query === dnsQuery(r.registrable, 'NS')) as LookupResult<DnsAnswer> | undefined;
    const rdap = latestFor(r.domain, (l) => l.kind === 'rdap-domain' && l.query === r.registrable) as LookupResult<RdapDomain> | undefined;
    return decideVerdict({ ...(ns ? { ns } : {}), ...(rdap ? { rdap } : {}) }).verdict;
  };
  const registered = active.filter((r) => worthEnriching(verdictOf(r)));
  type Task = () => Promise<void>;
  const tasks: Task[] = [];
  const seenReg = new Set<string>();
  for (const r of registered) {
    for (const type of ['A', 'AAAA', 'MX', 'TXT'] as RRType[]) {
      if (!settled(latestFor(r.domain, (l) => l.kind === 'dns' && l.query === dnsQuery(r.domain, type)), retry)) {
        tasks.push(async () => emit([r.domain], await collector.dns(r.domain, type, callOpts)));
      }
    }
    if (seenReg.has(r.registrable)) continue;
    seenReg.add(r.registrable);
    const sharers = byRegistrable.get(r.registrable)!.map((x) => x.domain);
    if (!latestFor(r.domain, (l) => l.kind === 'dns' && l.query.startsWith(WILDCARD_PREFIX) && l.query.endsWith(`.${r.registrable} A`))) {
      tasks.push(async () => emit(sharers, await collector.dns(wildcardProbeName(r.registrable), 'A', callOpts)));
    }
    if (!settled(latestFor(r.domain, (l) => l.kind === 'rdap-domain' && l.query === r.registrable), retry)) {
      tasks.push(async () => emit(sharers, await collector.rdapDomain(r.registrable, callOpts)));
    }
  }
  done = 0;
  o.onProgress?.({ phase: 'enrich', done, total: tasks.length });
  await pool(
    tasks,
    conc,
    async (t) => {
      await t();
      o.onProgress?.({ phase: 'enrich', done: ++done, total: tasks.length });
    },
    o.signal,
  );
  if (o.signal?.aborted) return;

  // ── Phase 3: networks for each unique IP ──
  const ipDomains = new Map<string, string[]>();
  const maxIps = o.maxIpsPerDomain ?? 4;
  for (const r of registered) {
    const ips: string[] = [];
    for (const type of ['A', 'AAAA'] as const) {
      const l = latestFor(r.domain, (x) => x.kind === 'dns' && x.query === dnsQuery(r.domain, type));
      if (l && (l.status === 'ok' || l.status === 'manual')) ips.push(...(type === 'A' ? aRecords(l.data as DnsAnswer) : aaaaRecords(l.data as DnsAnswer)));
    }
    for (const ip of ips.slice(0, maxIps)) ipDomains.set(ip, [...(ipDomains.get(ip) ?? []), r.domain]);
  }
  const ipTasks: Task[] = [];
  for (const [ip, domains] of ipDomains) {
    const first = domains[0]!;
    if (!settled(latestFor(first, (l) => l.kind === 'rdap-ip' && l.query === ip), retry)) {
      ipTasks.push(async () => emit(domains, await collector.rdapIp(ip, callOpts)));
    }
    if (o.useAbusix && !settled(latestFor(first, (l) => l.kind === 'abuse' && l.query === ip), retry)) {
      ipTasks.push(async () => emit(domains, await collector.abuseContact(ip, callOpts)));
    }
  }
  done = 0;
  o.onProgress?.({ phase: 'network', done, total: ipTasks.length });
  await pool(
    ipTasks,
    conc,
    async (t) => {
      await t();
      o.onProgress?.({ phase: 'network', done: ++done, total: ipTasks.length });
    },
    o.signal,
  );
}

/**
 * Settles "not delegated" candidates with registry RDAP. Domains on hold or
 * registered without nameservers are absent from DNS but still registered;
 * only a readable RDAP 404 proves availability. RDAP terms forbid bulk
 * querying, so this runs only for the top-N candidates the caller picks.
 */
export async function verifyWithRdap(records: readonly DomainRecord[], collector: Collector, o: Pick<ResolveOptions, 'signal' | 'onLookup' | 'onProgress'>): Promise<void> {
  const regs = [...new Map(records.map((r) => [r.registrable, r])).values()];
  let done = 0;
  o.onProgress?.({ phase: 'verify', done, total: regs.length });
  for (const r of regs) {
    if (o.signal?.aborted) return;
    const res = await collector.rdapDomain(r.registrable, o.signal ? { signal: o.signal } : {});
    o.onLookup(
      records.filter((x) => x.registrable === r.registrable).map((x) => x.domain),
      res,
    );
    o.onProgress?.({ phase: 'verify', done: ++done, total: regs.length });
  }
}
