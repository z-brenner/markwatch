// Permutation engine: runs the techniques over every seed, validates and
// IDNA-encodes the results, merges duplicates while keeping every technique
// and seed tag, then orders and caps them. Output is a pure function of the
// options: same input, byte-identical output.

import punycode from 'punycode/punycode.js';
import { TECHNIQUES, type Candidate, type PermutationOptions, type PermutationResult, type Technique, type TechniqueStats } from '../types';
import { encodeDomain } from '../domain/normalize';
import { registrableDomain } from '../domain/registrable';
import { KEYBOARD_ORDER } from './keyboards';
import { TECHNIQUE_FNS, type TechniqueContext } from './techniques';

export const DEFAULT_CAP = 5000;

/** Every technique; 'original' is always included by the engine and need not be listed. */
export const DEFAULT_TECHNIQUES: Technique[] = TECHNIQUES.filter((t) => t !== 'original');

interface Entry {
  domain: string;
  registrable: string;
  /** Bit i set ⇔ produced by TECHNIQUES[i]. */
  techs: number;
  seeds: Set<number>;
  minTech: number;
  minSeed: number;
}

const clean = (s: string) => s.trim().normalize('NFC').toLowerCase().normalize('NFC');

/** Normalizes a suffix or TLD ("CO.UK", ".com", "рф") to ASCII, or null if invalid. */
function asciiSuffix(raw: string): string | null {
  const s = clean(raw).replace(/^\.+|\.+$/g, '');
  if (!s) return null;
  // encodeDomain validates whole hostnames, and a bare TLD is not one; prefix a dummy label.
  return encodeDomain(`a.${s}`)?.slice(2) ?? null;
}

/** Seeds are processed in Unicode so techniques see "café", not "xn--caf-dma". */
function unicodeSeed(seed: string): string {
  try {
    return punycode.toUnicode(seed);
  } catch {
    return seed;
  }
}

const uniqueNonEmpty = (xs: Iterable<string | null>): string[] => [...new Set([...xs].filter((x): x is string => !!x))];

const compareEntries = (a: Entry, b: Entry): number =>
  a.minTech - b.minTech || a.minSeed - b.minSeed || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0);

function emptyResult(): PermutationResult {
  return { candidates: [], generated: 0, kept: 0, droppedByCap: 0, perTechnique: {} };
}

export function generatePermutations(opts: PermutationOptions): PermutationResult {
  const suffix = asciiSuffix(opts.baseSuffix);
  if (!suffix) return emptyResult();

  // A seed is one label; a dotted seed would silently turn into a subdomain.
  const seeds = uniqueNonEmpty(opts.seeds.map(clean)).filter((s) => !s.includes('.'));
  const enabled = new Set<Technique>(['original', ...opts.techniques]);
  const techniques = TECHNIQUES.filter((t) => enabled.has(t));
  const ctx: TechniqueContext = {
    suffix,
    keyboards: KEYBOARD_ORDER.filter((k) => opts.keyboards.includes(k)),
    tlds: uniqueNonEmpty(opts.tlds.map(asciiSuffix)),
    dictionary: uniqueNonEmpty(opts.dictionary.map(clean)),
  };
  const cap = opts.cap === Infinity ? Infinity : Number.isFinite(opts.cap) ? Math.max(0, Math.floor(opts.cap)) : DEFAULT_CAP;

  const byAscii = new Map<string, Entry>();
  // Raw (pre-encoding) string → entry, or null if invalid; skips re-validating repeats.
  const byRaw = new Map<string, Entry | null>();

  const add = (raw: string, tech: number, seed: number) => {
    let e = byRaw.get(raw);
    if (e === undefined) {
      const ascii = encodeDomain(raw);
      const registrable = ascii ? registrableDomain(ascii) : null;
      if (ascii && registrable) {
        e = byAscii.get(ascii) ?? { domain: ascii, registrable, techs: 0, seeds: new Set(), minTech: tech, minSeed: seed };
        byAscii.set(ascii, e);
      } else {
        e = null;
      }
      byRaw.set(raw, e);
    }
    if (!e) return;
    e.techs |= 1 << tech;
    e.seeds.add(seed);
    if (tech < e.minTech) e.minTech = tech;
    if (seed < e.minSeed) e.minSeed = seed;
  };

  seeds.forEach((seed, si) => {
    const label = unicodeSeed(seed);
    for (const t of techniques) {
      const ti = TECHNIQUES.indexOf(t);
      if (t === 'original') {
        add(`${label}.${suffix}`, ti, si);
      } else if (t === 'tld-swap') {
        for (const tld of TECHNIQUE_FNS[t](label, ctx)) add(`${label}.${tld}`, ti, si);
      } else {
        for (const v of TECHNIQUE_FNS[t](label, ctx)) add(`${v}.${suffix}`, ti, si);
      }
    }
  });

  const sorted = [...byAscii.values()].sort(compareEntries);
  const kept = sorted.slice(0, cap);

  const perTechnique: Partial<Record<Technique, TechniqueStats>> = {};
  for (const t of techniques) {
    const bit = 1 << TECHNIQUES.indexOf(t);
    const count = (es: Entry[]) => es.reduce((n, e) => n + (e.techs & bit ? 1 : 0), 0);
    perTechnique[t] = { generated: count(sorted), kept: count(kept) };
  }

  const candidates: Candidate[] = kept.map((e) => ({
    domain: e.domain,
    unicode: punycode.toUnicode(e.domain),
    registrable: e.registrable,
    techniques: TECHNIQUES.filter((_, i) => e.techs & (1 << i)),
    seeds: [...e.seeds].sort((a, b) => a - b).map((i) => seeds[i] ?? ''),
    sources: ['permutation'],
  }));

  return { candidates, generated: sorted.length, kept: kept.length, droppedByCap: sorted.length - kept.length, perTechnique };
}
