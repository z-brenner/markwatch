import { describe, expect, it } from 'vitest';
import { cyrillic } from '../../../src/core/permute/techniques/cyrillic';
import { normalizeDomain } from '../../../src/core/domain';

const ctx = (suffix: string) => ({ suffix, keyboards: [], tlds: [], dictionary: [] });
// а с м е (U+0430 U+0441 U+043C U+0435), spelled by code point so the test is unambiguous.
const ACME_CYR = String.fromCodePoint(0x430, 0x441, 0x43c, 0x435);

describe('cyrillic', () => {
  it('rewrites the whole label when every character maps', () => {
    expect(cyrillic('acme', ctx('com'))).toEqual([ACME_CYR]);
  });
  it('emits nothing when any character has no Cyrillic twin', () => {
    expect(cyrillic('fun', ctx('com'))).toEqual([]);
    expect(cyrillic('acme1', ctx('com'))).toEqual([]);
    expect(cyrillic('ac-me', ctx('com'))).toEqual([]);
    expect(cyrillic('café', ctx('com'))).toEqual([]);
  });
  it('emits nothing for registries with a known non-Cyrillic repertoire', () => {
    for (const suffix of ['de', 'co.uk', 'org.uk', 'fr', 'info']) expect(cyrillic('acme', ctx(suffix))).toEqual([]);
  });
  it('produces an IDNA-encodable label', () => {
    const [v] = cyrillic('acme', ctx('com'));
    expect(normalizeDomain(`${v}.com`)?.ascii).toMatch(/^xn--[a-z0-9-]+\.com$/);
  });
});
