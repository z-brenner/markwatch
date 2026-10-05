import { describe, expect, it } from 'vitest';
import { transposition } from '../../../src/core/permute/techniques/transposition';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('transposition', () => {
  it('swaps adjacent pairs in order', () => {
    expect(transposition('abc', ctx)).toEqual(['bac', 'acb']);
  });
  it('skips swaps of identical characters (identity)', () => {
    expect(transposition('aab', ctx)).toEqual(['aba']);
  });
  it('emits nothing for a 1-char label', () => {
    expect(transposition('a', ctx)).toEqual([]);
  });
  it('swaps IDN characters as whole code points', () => {
    expect(transposition('éa', ctx)).toEqual(['aé']);
  });
});
