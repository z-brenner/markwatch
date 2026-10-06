import { describe, expect, it } from 'vitest';
import { DEFAULT_TLDS } from '../../../src/config/tlds';
import { DEFAULT_DICTIONARY, RISKY_KEYWORDS } from '../../../src/config/keywords';
import { splitDomain } from '../../../src/core/domain';
import { DEFAULT_TECHNIQUES, TECHNIQUE_FNS } from '../../../src/core/permute';
import { TECHNIQUES } from '../../../src/core/types';

describe('default configuration', () => {
  it('DEFAULT_TLDS has about 60 unique ICANN suffixes', () => {
    expect(DEFAULT_TLDS.length).toBeGreaterThanOrEqual(55);
    expect(DEFAULT_TLDS.length).toBeLessThanOrEqual(65);
    expect(new Set(DEFAULT_TLDS).size).toBe(DEFAULT_TLDS.length);
    for (const tld of DEFAULT_TLDS) expect(splitDomain(`example.${tld}`)?.suffix).toBe(tld);
  });
  it('DEFAULT_TLDS leaves out restricted TLDs nobody else can register', () => {
    for (const tld of ['gov', 'edu', 'mil']) expect(DEFAULT_TLDS).not.toContain(tld);
  });
  it('dictionary words are unique valid labels and RISKY_KEYWORDS is a subset', () => {
    expect(new Set(DEFAULT_DICTIONARY).size).toBe(DEFAULT_DICTIONARY.length);
    for (const w of DEFAULT_DICTIONARY) expect(w).toMatch(/^[a-z0-9]+$/);
    for (const w of RISKY_KEYWORDS) expect(DEFAULT_DICTIONARY).toContain(w);
    expect(new Set(RISKY_KEYWORDS).size).toBe(RISKY_KEYWORDS.length);
  });
  it('DEFAULT_TECHNIQUES lists every technique but the implicit original, with a function for each', () => {
    expect(DEFAULT_TECHNIQUES).toEqual(TECHNIQUES.filter((t) => t !== 'original'));
    expect(Object.keys(TECHNIQUE_FNS).sort()).toEqual([...DEFAULT_TECHNIQUES].sort());
  });
});
