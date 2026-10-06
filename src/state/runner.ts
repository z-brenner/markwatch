// Ephemeral run state (progress, cancellation, CT results) that is not part
// of the case file. Orchestrates discovery → CT → resolution through the
// Collector interface; the UI never calls the network directly.
import type { Collector } from '../collect/Collector';
import { BrowserCollector } from '../collect/BrowserCollector';
import { HostLimiter } from '../collect/limiter';
import { registrableNamesFromCt } from '../core/ct/crtsh';
import { watchCspViolations } from '../collect/transport';
import { runDiscovery, type DiscoveryOutput } from '../pipeline/discovery';
import { resolveDomains, verifyWithRdap, type ResolveProgress } from '../pipeline/resolve';
import { normalizeDomain, registrableDomain, markToSeeds } from '../pipeline/deps';
import { nsHosts } from '../core/dns/doh';
import { nowUtc } from '../core/util';
import type { CtEntry, LookupResult } from '../core/types';
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
  /** Certificate ids that came from user-pasted crt.sh data, so derived lookups stay labelled as manual. */
  private manualCtIds = new Set<number>();
  /** One limiter for the session, so crt.sh spacing and registry cooldowns survive cancel/restart. */
  private limiter = new HostLimiter();

  constructor(
    private store: CaseStore,
    private collectorFactory?: (store: CaseStore) => Collector,
  ) {
    watchCspViolations();
  }

  private collector(): Collector {
    return this.collectorFactory?.(this.store) ?? new BrowserCollector({ primaryResolver: this.store.state.settings.primaryResolver, limiter: this.limiter });
  }

  /** Clears run state when a different case is loaded. */
  reset(): void {
    this.cancel();
    this.manualCtIds.clear();
    this.snap = { running: null, ct: [], ctEntries: [], manual: [] };
    for (const l of this.listeners) l();
  }

  /** Records a lookup only if the case it was started for is still loaded. */
  private recorder(): (domains: string[], r: LookupResult<unknown>) => void {
    const gen = this.store.generation;
    return (domains, r) => {
      if (this.store.generation === gen) this.store.recordLookup(domains, r);
    };
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
    const collector = this.collector();
    const record = this.recorder();
    const gen = this.store.generation;
    const results: RunSnapshot['ct'] = [];
    try {
      // Prefix first (most reliable on crt.sh), then substring (best-effort).
      // The limiter spaces crt.sh requests 12 s apart.
      for (const term of terms) {
        for (const mode of ['prefix', 'substring'] as const) {
          if (this.abort.signal.aborted) break;
          const result = await collector.ctSearch(term, { signal: this.abort.signal, mode });
          record([], result);
          results.push({ term: result.query, result });
          this.set({ ct: [...results] });
        }
      }
      if (this.store.generation === gen) this.applyCt(results);
    } finally {
      this.set({ running: null });
    }
  }

  /** Accepts crt.sh JSON the user pasted after a blocked search. `term` is the blocked lookup's query label. */
  applyManualCt(term: string, entries: CtEntry[], pastedText: string): void {
    const result: LookupResult<CtEntry[]> = { status: 'manual', kind: 'ct', query: term, source: 'crt.sh (pasted by user)', at: nowUtc(), data: entries, pastedText };
    this.store.recordLookup([], result, 'user');
    for (const e of entries) this.manualCtIds.add(e.id);
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
    const byReg = registrableNamesFromCt(this.snap.ctEntries, (n) => {
      const norm = normalizeDomain(n);
      return norm ? registrableDomain(norm.ascii) : null;
    });
    for (const [reg, list] of byReg) {
      const query = `crt.sh certificates for ${reg}`;
      const ids = list.map((e) => e.id).sort((a, b) => a - b).join(',');
      const domains = this.store.state.domains.filter((d) => {
        if (d.registrable !== reg) return false;
        // Skip only if this exact set of certificates is already attached.
        const prev = [...d.lookups].reverse().find((l) => l.kind === 'ct' && l.query === query);
        const prevIds = prev && (prev.status === 'ok' || prev.status === 'manual') ? (prev.data as CtEntry[]).map((e) => e.id).sort((a, b) => a - b).join(',') : null;
        return prevIds !== ids;
      });
      if (!domains.length) continue;
      const manual = list.some((e) => this.manualCtIds.has(e.id));
      const at = nowUtc();
      const result: LookupResult<CtEntry[]> = manual
        ? { status: 'manual', kind: 'ct', query, source: 'crt.sh (includes data pasted by the user)', at, data: list, pastedText: 'See the pasted crt.sh lookup on the Discover page and in the audit log.' }
        : { status: 'ok', kind: 'ct', query, source: 'crt.sh', at, data: list };
      this.store.recordLookup(
        domains.map((d) => d.domain),
        result,
      );
    }
  }

  async resolve(retryBlocked = false): Promise<void> {
    if (this.snap.running) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.set({ running: 'resolve', error: undefined, progress: undefined });
    const collector = this.collector();
    try {
      await this.resolvePrimaryNs(collector, signal);
      const record = this.recorder();
      const gen = this.store.generation;
      await resolveDomains(this.store.state.domains, collector, {
        signal,
        retryBlocked,
        useAbusix: this.store.state.settings.useAbusix,
        onLookup: record,
        onReuse: (domains, r) => {
          if (this.store.generation === gen) this.store.applyExistingLookup(domains, r);
        },
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
    const gen = this.store.generation;
    const r = await collector.dns(reg, 'NS', { signal });
    if (this.store.generation !== gen) return;
    this.store.recordLookup([], r);
    if (r.status === 'ok') {
      this.store.primaryNs = nsHosts(r.data);
      this.store.rescoreAll();
    }
  }

  /** RDAP check for the highest-scoring "not delegated" candidates. */
  async verifyTop(n: number): Promise<void> {
    if (this.snap.running) return;
    const targets = this.store.state.domains
      .filter(
        (d) =>
          !d.inventory &&
          (d.facts?.verdict === 'not_delegated' || d.facts?.verdict === 'probably_unregistered') &&
          // Skip anything already answered, and TLDs without an RDAP service.
          !d.lookups.some((l) => l.kind === 'rdap-domain' && (l.status !== 'blocked' || l.reason === 'unsupported')),
      )
      .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
      .slice(0, n);
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.set({ running: 'verify', progress: undefined });
    try {
      await verifyWithRdap(targets, this.collector(), {
        signal,
        allRecords: this.store.state.domains,
        onLookup: this.recorder(),
        onProgress: (progress) => this.set({ progress }),
      });
    } finally {
      this.set({ running: null });
    }
  }
}
