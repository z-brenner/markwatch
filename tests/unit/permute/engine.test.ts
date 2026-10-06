import { describe, expect, it } from 'vitest';
import { DEFAULT_TECHNIQUES, generatePermutations } from '../../../src/core/permute';
import { isValidAsciiDomain, normalizeDomain } from '../../../src/core/domain';
import { DEFAULT_TLDS } from '../../../src/config/tlds';
import { DEFAULT_DICTIONARY } from '../../../src/config/keywords';
import { TECHNIQUES, type PermutationOptions, type Technique } from '../../../src/core/types';

const opts = (o: Partial<PermutationOptions>): PermutationOptions => ({
  seeds: ['acme'],
  baseSuffix: 'com',
  techniques: [],
  keyboards: ['qwerty'],
  tlds: [],
  dictionary: [],
  cap: 5000,
  ...o,
});
const domains = (o: Partial<PermutationOptions>) => generatePermutations(opts(o)).candidates.map((c) => c.domain);
const find = (o: Partial<PermutationOptions>, domain: string) => generatePermutations(opts(o)).candidates.find((c) => c.domain === domain);

const FULL: PermutationOptions = {
  seeds: ['acmewidget', 'acme'],
  baseSuffix: 'com',
  techniques: DEFAULT_TECHNIQUES,
  keyboards: ['qwerty', 'qwertz', 'azerty'],
  tlds: DEFAULT_TLDS,
  dictionary: DEFAULT_DICTIONARY,
  cap: 5000,
};

describe('generatePermutations', () => {
  it('always includes the original and orders by technique, then domain', () => {
    const r = generatePermutations(opts({ seeds: ['abc'], techniques: ['omission'] }));
    expect(r.candidates).toEqual([
      { domain: 'abc.com', unicode: 'abc.com', registrable: 'abc.com', techniques: ['original'], seeds: ['abc'], sources: ['permutation'] },
      { domain: 'ab.com', unicode: 'ab.com', registrable: 'ab.com', techniques: ['omission'], seeds: ['abc'], sources: ['permutation'] },
      { domain: 'ac.com', unicode: 'ac.com', registrable: 'ac.com', techniques: ['omission'], seeds: ['abc'], sources: ['permutation'] },
      { domain: 'bc.com', unicode: 'bc.com', registrable: 'bc.com', techniques: ['omission'], seeds: ['abc'], sources: ['permutation'] },
    ]);
    expect(r).toMatchObject({ generated: 4, kept: 4, droppedByCap: 0 });
    expect(r.perTechnique).toEqual({ original: { generated: 1, kept: 1 }, omission: { generated: 3, kept: 3 } });
  });

  it('merges techniques for a domain produced twice, in TECHNIQUES order', () => {
    const r = generatePermutations(opts({ seeds: ['bat'], techniques: ['replacement', 'vowel-swap'] }));
    const bet = r.candidates.find((c) => c.domain === 'bet.com');
    expect(bet?.techniques).toEqual(['vowel-swap', 'replacement']);
    expect(new Set(r.candidates.map((c) => c.domain)).size).toBe(r.candidates.length);
    // Ordered by its best technique: vowel-swap results come before replacement-only ones.
    const idx = (d: string) => r.candidates.findIndex((c) => c.domain === d);
    expect(idx('bet.com')).toBeLessThan(idx('aat.com'));
  });

  it('merges seeds, in seed order', () => {
    const c = find({ seeds: ['acme', 'acmes'], techniques: ['plural'] }, 'acmes.com');
    expect(c?.techniques).toEqual(['original', 'plural']);
    expect(c?.seeds).toEqual(['acme', 'acmes']);
  });

  it('dedupes seeds and ignores dotted ones', () => {
    const r = generatePermutations(opts({ seeds: ['acme', 'ACME', 'acme', 'acme.com', ''] }));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.seeds).toEqual(['acme']);
  });

  it('builds tld-swap candidates from the seed and each TLD, dropping invalid TLDs', () => {
    expect(domains({ techniques: ['tld-swap'], tlds: ['net', 'com', '.CO.UK', 'bad_tld', 'net'] })).toEqual(['acme.com', 'acme.co.uk', 'acme.net']);
  });

  it('handles a multi-part base suffix', () => {
    const r = generatePermutations(opts({ seeds: ['abc'], baseSuffix: 'co.uk', techniques: ['omission'] }));
    expect(r.candidates.map((c) => [c.domain, c.registrable])).toEqual([
      ['abc.co.uk', 'abc.co.uk'],
      ['ab.co.uk', 'ab.co.uk'],
      ['ac.co.uk', 'ac.co.uk'],
      ['bc.co.uk', 'bc.co.uk'],
    ]);
  });

  it('computes the registrable domain of dot-insertion results', () => {
    const r = generatePermutations(opts({ seeds: ['example'], techniques: ['dot-insertion'] }));
    const ex = r.candidates.find((c) => c.domain === 'ex.ample.com');
    expect(ex).toMatchObject({ registrable: 'ample.com', techniques: ['dot-insertion'] });
    expect(r.candidates.find((c) => c.domain === 'e.xample.com')?.registrable).toBe('xample.com');
  });

  it('drops candidates without a registrable domain', () => {
    // "co.uk" is itself a public suffix.
    expect(generatePermutations(opts({ seeds: ['co'], baseSuffix: 'uk' })).candidates).toEqual([]);
  });

  it('IDNA-encodes IDN seeds and accepts them in either form', () => {
    const r = generatePermutations(opts({ seeds: ['café'], techniques: ['omission'] }));
    expect(r.candidates[0]).toMatchObject({ domain: 'xn--caf-dma.com', unicode: 'café.com', registrable: 'xn--caf-dma.com', seeds: ['café'] });
    expect(r.candidates.slice(1).map((c) => c.unicode).sort()).toEqual(['afé.com', 'caf.com', 'caé.com', 'cfé.com']);
    // Ordering uses the ASCII form, so "caf.com" sorts before every "xn--" domain.
    expect(r.candidates[1]?.domain).toBe('caf.com');
    const viaPuny = generatePermutations(opts({ seeds: ['xn--caf-dma'], techniques: ['omission'] }));
    expect(viaPuny.candidates.map((c) => c.domain)).toEqual(r.candidates.map((c) => c.domain));
    expect(viaPuny.candidates[0]?.seeds).toEqual(['xn--caf-dma']);
  });

  it('drops results that are not valid hostnames', () => {
    // 1-char seed: omission would leave an empty label.
    expect(domains({ seeds: ['a'], techniques: ['omission'] })).toEqual(['a.com']);
    // Replacement with "-" at either edge is invalid: 72 variants, 70 valid.
    const r = generatePermutations(opts({ seeds: ['ab'], techniques: ['replacement'] }));
    expect(r.perTechnique.replacement).toEqual({ generated: 70, kept: 70 });
    // "--" in positions 3–4 is reserved for A-labels; elsewhere it is plain LDH.
    const hy = domains({ seeds: ['ab-cd'], techniques: ['replacement'] });
    expect(hy).not.toContain('ab--d.com');
    expect(hy).toContain('a--cd.com');
    // A 63-char seed cannot grow.
    const long = 'a'.repeat(63);
    expect(domains({ seeds: [long], techniques: ['repetition'] })).toEqual([`${long}.com`]);
  });

  it('returns nothing for an invalid base suffix', () => {
    expect(generatePermutations(opts({ baseSuffix: 'not a suffix' }))).toEqual({ candidates: [], generated: 0, kept: 0, droppedByCap: 0, perTechnique: {} });
  });

  it('applies the cap by technique priority, then seed, then domain, and counts per technique', () => {
    const r = generatePermutations(opts({ seeds: ['abc'], techniques: ['omission', 'replacement'], cap: 5 }));
    expect(r.candidates.map((c) => c.domain)).toEqual(['abc.com', 'ab.com', 'ac.com', 'bc.com', '0bc.com']);
    // 3×36 replacements minus "-bc" and "ab-".
    expect(r).toMatchObject({ generated: 110, kept: 5, droppedByCap: 105 });
    expect(r.perTechnique).toEqual({
      original: { generated: 1, kept: 1 },
      omission: { generated: 3, kept: 3 },
      replacement: { generated: 106, kept: 1 },
    });
  });

  it('orders earlier seeds first within a technique', () => {
    const r = generatePermutations(opts({ seeds: ['zz', 'aa'], techniques: ['repetition'] }));
    expect(r.candidates.map((c) => c.domain)).toEqual(['zz.com', 'aa.com', 'zzz.com', 'aaa.com']);
  });

  it('falls back to the default cap when the cap is not a number', () => {
    const r = generatePermutations(opts({ seeds: ['abc'], techniques: ['omission'], cap: Number.NaN }));
    expect(r.kept).toBe(4);
  });

  it('handles cap 0', () => {
    const r = generatePermutations(opts({ seeds: ['abc'], techniques: ['omission'], cap: 0 }));
    expect(r).toMatchObject({ candidates: [], generated: 4, kept: 0, droppedByCap: 4 });
    expect(r.perTechnique.omission).toEqual({ generated: 3, kept: 0 });
  });

  it('emits only valid, canonical, sorted candidates for a full run', () => {
    const r = generatePermutations({ ...FULL, cap: Infinity });
    expect(r.kept).toBe(r.generated);
    const order = (t: Technique[]) => Math.min(...t.map((x) => TECHNIQUES.indexOf(x)));
    let prev: [number, number, string] = [-1, -1, ''];
    for (const c of r.candidates) {
      expect(isValidAsciiDomain(c.domain)).toBe(true);
      expect(normalizeDomain(c.unicode)?.ascii).toBe(c.domain);
      expect(c.techniques).toEqual(TECHNIQUES.filter((t) => c.techniques.includes(t)));
      const key: [number, number, string] = [order(c.techniques), Math.min(...c.seeds.map((s) => FULL.seeds.indexOf(s))), c.domain];
      const cmp = key[0] - prev[0] || key[1] - prev[1] || (key[2] > prev[2] ? 1 : -1);
      expect(cmp).toBeGreaterThan(0);
      prev = key;
    }
    for (const t of TECHNIQUES) {
      const tagged = r.candidates.filter((c) => c.techniques.includes(t)).length;
      expect(r.perTechnique[t]?.generated).toBe(tagged);
    }
  });

  it('is byte-identical across runs and independent of option order', () => {
    const a = JSON.stringify(generatePermutations(FULL));
    const b = JSON.stringify(generatePermutations(FULL));
    const shuffled = JSON.stringify(
      generatePermutations({ ...FULL, techniques: [...FULL.techniques].reverse(), keyboards: ['azerty', 'qwerty', 'qwertz'] }),
    );
    expect(b).toBe(a);
    expect(shuffled).toBe(a);
  });

  it('generates a 10-char seed with every technique and the default TLDs quickly', () => {
    const t0 = performance.now();
    const r = generatePermutations({ ...FULL, seeds: ['acmewidget'] });
    const ms = performance.now() - t0;
    expect(r.kept).toBe(5000);
    expect(ms).toBeLessThan(2000);
  });
});
