// Merges permutation output, certificate-transparency hits and manual entries
// into domain records, labels inventory matches, and preserves everything
// already known about domains from earlier runs.
import { generatePermutations, matchInventory, markToSeeds, normalizeDomain, registrableDomain, splitDomain } from './deps';
import type { Candidate, CaseState, CtEntry, DiscoverySource, DomainRecord, PermutationResult, Technique } from '../core/types';
import { TECHNIQUES } from '../core/types';
import { uniq } from '../core/util';

export interface DiscoveryInput {
  state: CaseState;
  ctEntries?: CtEntry[];
  manual?: string[];
}

export interface DiscoveryOutput {
  records: DomainRecord[];
  permutation: PermutationResult | null;
  added: number;
  excludedByInventory: number;
  invalidManual: string[];
}

function emptyRecord(c: Candidate): DomainRecord {
  return {
    domain: c.domain,
    unicode: c.unicode,
    registrable: c.registrable,
    techniques: c.techniques,
    seeds: c.seeds,
    sources: c.sources,
    lookups: [],
    acks: [],
    dismissedWarnings: [],
    drafts: [],
    evidence: [],
  };
}

const techniqueOrder = (ts: Technique[]) => [...new Set(ts)].sort((a, b) => TECHNIQUES.indexOf(a) - TECHNIQUES.indexOf(b));
const sourceOrder: DiscoverySource[] = ['permutation', 'ct', 'manual'];

export function runDiscovery({ state, ctEntries = [], manual = [] }: DiscoveryInput): DiscoveryOutput {
  const primary = normalizeDomain(state.subject.primaryDomain);
  const split = primary ? splitDomain(primary.ascii) : null;
  const candidates = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const prev = candidates.get(c.domain);
    if (!prev) return void candidates.set(c.domain, c);
    prev.techniques = techniqueOrder([...prev.techniques, ...c.techniques]);
    prev.seeds = uniq([...prev.seeds, ...c.seeds]);
    prev.sources = sourceOrder.filter((s) => prev.sources.includes(s) || c.sources.includes(s));
  };

  let permutation: PermutationResult | null = null;
  if (split) {
    const seeds = markToSeeds(state.subject.marks, primary!.ascii);
    permutation = generatePermutations({
      seeds,
      baseSuffix: split.suffix,
      techniques: state.settings.techniques,
      keyboards: state.settings.keyboards,
      tlds: state.settings.tlds,
      dictionary: state.settings.dictionary,
      cap: state.settings.cap,
    });
    for (const c of permutation.candidates) add({ ...c });
  }

  // CT: one record per registrable domain seen in certificates.
  for (const e of ctEntries) {
    for (const raw of e.names) {
      const n = normalizeDomain(raw.replace(/^\*\./, ''));
      if (!n) continue;
      const reg = registrableDomain(n.ascii);
      if (!reg) continue;
      const u = normalizeDomain(reg)!;
      add({ domain: reg, unicode: u.unicode, registrable: reg, techniques: [], seeds: [], sources: ['ct'] });
    }
  }

  const invalidManual: string[] = [];
  for (const m of manual) {
    const n = normalizeDomain(m);
    const reg = n && registrableDomain(n.ascii);
    if (!n || !reg) {
      invalidManual.push(m);
      continue;
    }
    add({ domain: n.ascii, unicode: n.unicode, registrable: reg, techniques: [], seeds: [], sources: ['manual'] });
  }

  // Merge with existing records, preserving lookups, classifications and drafts.
  const existing = new Map(state.domains.map((d) => [d.domain, d]));
  let added = 0;
  for (const c of candidates.values()) {
    const prev = existing.get(c.domain);
    if (prev) {
      existing.set(c.domain, {
        ...prev,
        techniques: techniqueOrder([...prev.techniques, ...c.techniques]),
        seeds: uniq([...prev.seeds, ...c.seeds]),
        sources: sourceOrder.filter((s) => prev.sources.includes(s) || c.sources.includes(s)),
      });
    } else {
      existing.set(c.domain, emptyRecord(c));
      added++;
    }
  }

  // Inventory labels (recomputed for every record, since the inventory may have changed).
  const primaryReg = primary ? registrableDomain(primary.ascii) : null;
  let excludedByInventory = 0;
  const records = [...existing.values()].map((r) => {
    const { inventory: _old, ...rest } = r;
    const hit = matchInventory(r.domain, state.inventory);
    if (hit) {
      excludedByInventory++;
      return { ...rest, inventory: { kind: hit.kind, pattern: hit.pattern, ...(hit.party ? { party: hit.party } : {}) } };
    }
    if (primaryReg && r.registrable === primaryReg) {
      excludedByInventory++;
      return { ...rest, inventory: { kind: 'owned' as const, pattern: primaryReg, party: 'Primary domain' } };
    }
    return rest;
  });

  return { records, permutation, added, excludedByInventory, invalidManual };
}
