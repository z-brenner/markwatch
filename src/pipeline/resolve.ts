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
  /** Called when an existing answer is applied to more domains (no new query). Defaults to onLookup. */
  onReuse?: (domains: string[], result: AnyLookup) => void;
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
  const reuse = (domains: string[], res: AnyLookup) => {
    for (const d of domains) local.get(d)?.push(res);
    (o.onReuse ?? o.onLookup)(domains, res);
  };
  const latestFor = (domain: string, pred: (l: AnyLookup) => boolean) => latest(local.get(domain) ?? [], pred);

  /**
   * For a lookup shared by several domains (same registrable, same IP): which
   * domains still need it, and an already-settled answer to hand them instead
   * of querying again. Returns null when every sharer is settled.
   */
  const plan = (domains: string[], pred: (l: AnyLookup) => boolean): { lacking: string[]; existing?: AnyLookup } | null => {
    const lacking = domains.filter((d) => !settled(latestFor(d, pred), retry));
    if (!lacking.length) return null;
    // Prefer a readable answer (e.g. a manual paste) over a settled-but-blocked one.
    const readable = (d: string) => {
      const l = latestFor(d, pred);
      return !!l && l.status !== 'blocked';
    };
    const holder = domains.find((d) => settled(latestFor(d, pred), retry) && readable(d)) ?? domains.find((d) => settled(latestFor(d, pred), retry));
    const existing = holder ? latestFor(holder, pred) : undefined;
    return existing ? { lacking, existing } : { lacking };
  };
  type Task = () => Promise<void>;
  const schedule = (tasks: Task[], domains: string[], pred: (l: AnyLookup) => boolean, run: () => Promise<AnyLookup>) => {
    const p = plan(domains, pred);
    if (!p) return;
    if (p.existing) reuse(p.lacking, p.existing);
    else tasks.push(async () => emit(p.lacking, await run()));
  };

  // ── Phase 1: NS at the registrable domain ──
  const nsTasks: Task[] = [];
  for (const [reg, recs] of byRegistrable) {
    schedule(nsTasks, recs.map((r) => r.domain), (l) => l.kind === 'dns' && l.query === dnsQuery(reg, 'NS'), () => collector.dns(reg, 'NS', callOpts));
  }
  await runTasks('ns', nsTasks, conc, o);
  if (o.signal?.aborted) return;

  // ── Phase 2: enrich registered domains ──
  const verdictOf = (r: DomainRecord) => {
    const ns = latestFor(r.domain, (l) => l.kind === 'dns' && l.query === dnsQuery(r.registrable, 'NS')) as LookupResult<DnsAnswer> | undefined;
    const rdap = latestFor(r.domain, (l) => l.kind === 'rdap-domain' && l.query === r.registrable) as LookupResult<RdapDomain> | undefined;
    return decideVerdict({ ...(ns ? { ns } : {}), ...(rdap ? { rdap } : {}) }).verdict;
  };
  const registered = active.filter((r) => worthEnriching(verdictOf(r)));
  const dnsTasks: Task[] = [];
  const rdapTasks: Task[] = [];
  const seenReg = new Set<string>();
  for (const r of registered) {
    for (const type of ['A', 'AAAA', 'MX', 'TXT'] as RRType[]) {
      schedule(dnsTasks, [r.domain], (l) => l.kind === 'dns' && l.query === dnsQuery(r.domain, type), () => collector.dns(r.domain, type, callOpts));
    }
    if (seenReg.has(r.registrable)) continue;
    seenReg.add(r.registrable);
    const sharers = byRegistrable.get(r.registrable)!.map((x) => x.domain);
    schedule(
      dnsTasks,
      sharers,
      (l) => l.kind === 'dns' && l.query.startsWith(WILDCARD_PREFIX) && l.query.endsWith(`.${r.registrable} A`),
      () => collector.dns(wildcardProbeName(r.registrable), 'A', callOpts),
    );
    schedule(rdapTasks, sharers, (l) => l.kind === 'rdap-domain' && l.query === r.registrable, () => collector.rdapDomain(r.registrable, callOpts));
  }
  // Separate pools: RDAP is rate-limited per registry (2 concurrent, with
  // cooldowns), and must not hold the DNS workers hostage. One progress count.
  const enrich = { done: 0, total: dnsTasks.length + rdapTasks.length };
  o.onProgress?.({ phase: 'enrich', ...enrich });
  const tick = () => o.onProgress?.({ phase: 'enrich', done: ++enrich.done, total: enrich.total });
  await Promise.all([pool(dnsTasks, conc, async (t) => (await t(), tick()), o.signal), pool(rdapTasks, 2, async (t) => (await t(), tick()), o.signal)]);
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
    schedule(ipTasks, domains, (l) => l.kind === 'rdap-ip' && l.query === ip, () => collector.rdapIp(ip, callOpts));
    if (o.useAbusix) schedule(ipTasks, domains, (l) => l.kind === 'abuse' && l.query === ip, () => collector.abuseContact(ip, callOpts));
  }
  await runTasks('network', ipTasks, conc, o);
}

async function runTasks(phase: ResolveProgress['phase'], tasks: (() => Promise<void>)[], n: number, o: ResolveOptions): Promise<void> {
  let done = 0;
  o.onProgress?.({ phase, done, total: tasks.length });
  await pool(
    tasks,
    n,
    async (t) => {
      await t();
      o.onProgress?.({ phase, done: ++done, total: tasks.length });
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
export async function verifyWithRdap(
  records: readonly DomainRecord[],
  collector: Collector,
  o: Pick<ResolveOptions, 'signal' | 'onLookup' | 'onProgress'> & { allRecords?: readonly DomainRecord[] },
): Promise<void> {
  const regs = [...new Map(records.map((r) => [r.registrable, r])).values()];
  const everyone = o.allRecords ?? records;
  let done = 0;
  o.onProgress?.({ phase: 'verify', done, total: regs.length });
  for (const r of regs) {
    if (o.signal?.aborted) return;
    const res = await collector.rdapDomain(r.registrable, o.signal ? { signal: o.signal } : {});
    // Every domain on this registrable gets the answer, not only the selected ones.
    o.onLookup(
      everyone.filter((x) => x.registrable === r.registrable && !x.inventory).map((x) => x.domain),
      res,
    );
    o.onProgress?.({ phase: 'verify', done: ++done, total: regs.length });
  }
}
