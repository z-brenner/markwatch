// Ephemeral run state (progress, cancellation, CT results) that is not part
// of the case file. Orchestrates discovery → CT → resolution through the
// Collector interface; the UI never calls the network directly.
import type { Collector } from '../collect/Collector';
import { BrowserCollector } from '../collect/BrowserCollector';
import { watchCspViolations } from '../collect/transport';
import { runDiscovery, type DiscoveryOutput } from '../pipeline/discovery';
import { resolveDomains, verifyWithRdap, type ResolveProgress } from '../pipeline/resolve';
import { normalizeDomain, registrableDomain, markToSeeds } from '../pipeline/deps';
import { nsHosts } from '../core/dns/doh';
import { nowUtc } from '../core/util';
import type { CtEntry, DnsAnswer, LookupResult } from '../core/types';
import type { CaseStore } from './store';

export interface RunSnapshot {
  running: null | 'discover' | 'ct' | 'resolve' | 'verify';
  progress?: ResolveProgress;
  lastDiscovery?: Omit<DiscoveryOutput, 'records'> & { at: string };
  ct: { term: string; result: LookupResult<CtEntry[]> }[];
  ctEntries: CtEntry[];
  manual: string[];
  error?: string;
}

/** Shortest seed crt.sh can search without returning an unmanageable result set. */
export const CT_MIN_TERM = 4;

export class Runner {
  private snap: RunSnapshot = { running: null, ct: [], ctEntries: [], manual: [] };
  private listeners = new Set<() => void>();
  private abort?: AbortController;

  constructor(
    private store: CaseStore,
    private collectorFactory: (store: CaseStore) => Collector = (s) => new BrowserCollector({ primaryResolver: s.state.settings.primaryResolver }),
  ) {
    watchCspViolations();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private set(p: Partial<RunSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  cancel(): void {
    this.abort?.abort();
  }

  setManual(manual: string[]): void {
    this.set({ manual });
  }

  /** Generates candidates and merges CT hits and manual entries into the case. */
  discover(): DiscoveryOutput {
    const out = runDiscovery({ state: this.store.state, ctEntries: this.snap.ctEntries, manual: this.snap.manual });
    const { records, ...summary } = out;
    this.store.replaceDomains(records, {
      generated: summary.permutation?.generated ?? 0,
      kept: summary.permutation?.kept ?? 0,
      droppedByCap: summary.permutation?.droppedByCap ?? 0,
      added: summary.added,
      excludedByInventory: summary.excludedByInventory,
      ctEntries: this.snap.ctEntries.length,
      manual: this.snap.manual.length,
      total: records.length,
    });
    this.attachCtLookups();
    this.set({ lastDiscovery: { ...summary, at: nowUtc() } });
    return out;
  }

  /** CT search terms: each seed long enough for crt.sh to handle. */
  ctTerms(): { terms: string[]; skipped: string[] } {
    const primary = normalizeDomain(this.store.state.subject.primaryDomain);
    if (!primary) return { terms: [], skipped: [] };
    const seeds = markToSeeds(this.store.state.subject.marks, primary.ascii).filter((s) => /^[a-z0-9-]+$/.test(s));
    return { terms: seeds.filter((s) => s.length >= CT_MIN_TERM), skipped: seeds.filter((s) => s.length < CT_MIN_TERM) };
  }

  async ctSearch(): Promise<void> {
    if (this.snap.running) return;
    const { terms } = this.ctTerms();
    this.abort = new AbortController();
    this.set({ running: 'ct', error: undefined });
    const collector = this.collectorFactory(this.store);
    const results: RunSnapshot['ct'] = [];
    try {
      for (const term of terms) {
        if (this.abort.signal.aborted) break;
        const result = await collector.ctSearch(term, { signal: this.abort.signal });
        this.store.recordLookup([], result);
        results.push({ term, result });
        this.set({ ct: [...results] });
      }
      this.applyCt(results);
    } finally {
      this.set({ running: null });
    }
  }

  /** Accepts crt.sh JSON the user pasted after a blocked search. */
  applyManualCt(term: string, entries: CtEntry[], pastedText: string): void {
    const result: LookupResult<CtEntry[]> = { status: 'manual', kind: 'ct', query: term, source: 'crt.sh (pasted by user)', at: nowUtc(), data: entries, pastedText };
    this.store.recordLookup([], result, 'user');
    const ct = [...this.snap.ct.filter((c) => c.term !== term), { term, result }];
    this.set({ ct });
    this.applyCt(ct);
  }

  private applyCt(results: RunSnapshot['ct']): void {
    const entries = new Map<number, CtEntry>();
    for (const { result } of results) if (result.status === 'ok' || result.status === 'manual') for (const e of result.data) entries.set(e.id, e);
    this.set({ ctEntries: [...entries.values()] });
    if (entries.size) this.discover();
  }

  /** Attaches each certificate to the domain records it names, so the CT signal has a source. */
  private attachCtLookups(): void {
    const byReg = new Map<string, CtEntry[]>();
    for (const e of this.snap.ctEntries) {
      for (const n of e.names) {
        const norm = normalizeDomain(n.replace(/^\*\./, ''));
        const reg = norm && registrableDomain(norm.ascii);
        if (reg) byReg.set(reg, [...new Set([...(byReg.get(reg) ?? []), e])]);
      }
    }
    for (const [reg, list] of byReg) {
      const domains = this.store.state.domains.filter((d) => d.registrable === reg && !d.lookups.some((l) => l.kind === 'ct' && l.query === `crt.sh certificates for ${reg}`));
      if (!domains.length) continue;
      this.store.recordLookup(
        domains.map((d) => d.domain),
        { status: 'ok', kind: 'ct', query: `crt.sh certificates for ${reg}`, source: 'crt.sh', at: nowUtc(), data: list },
      );
    }
  }

  async resolve(retryBlocked = false): Promise<void> {
    if (this.snap.running) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.set({ running: 'resolve', error: undefined, progress: undefined });
    const collector = this.collectorFactory(this.store);
    try {
      await this.resolvePrimaryNs(collector, signal);
      await resolveDomains(this.store.state.domains, collector, {
        signal,
        retryBlocked,
        useAbusix: this.store.state.settings.useAbusix,
        onLookup: (domains, r) => this.store.recordLookup(domains, r),
        onProgress: (progress) => this.set({ progress }),
      });
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.set({ running: null });
    }
  }

  private async resolvePrimaryNs(collector: Collector, signal: AbortSignal): Promise<void> {
    if (this.store.primaryNs.length) return;
    const primary = normalizeDomain(this.store.state.subject.primaryDomain);
    const reg = primary && registrableDomain(primary.ascii);
    if (!reg) return;
    const r = await collector.dns(reg, 'NS', { signal });
    this.store.recordLookup([], r);
    if (r.status === 'ok') {
      this.store.primaryNs = nsHosts(r.data as DnsAnswer);
      this.store.rescoreAll();
    }
  }

  /** RDAP check for the highest-scoring "not delegated" candidates. */
  async verifyTop(n: number): Promise<void> {
    if (this.snap.running) return;
    const targets = this.store.state.domains
      .filter((d) => !d.inventory && d.facts?.verdict === 'not_delegated' && !d.lookups.some((l) => l.kind === 'rdap-domain' && l.status !== 'blocked'))
      .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
      .slice(0, n);
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.set({ running: 'verify', progress: undefined });
    try {
      await verifyWithRdap(targets, this.collectorFactory(this.store), {
        signal,
        onLookup: (domains, r) => this.store.recordLookup(domains, r),
        onProgress: (progress) => this.set({ progress }),
      });
    } finally {
      this.set({ running: null });
    }
  }
}
