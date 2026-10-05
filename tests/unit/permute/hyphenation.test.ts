import { describe, expect, it } from 'vitest';
import { hyphenation } from '../../../src/core/permute/techniques/hyphenation';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('hyphenation', () => {
  it('inserts a hyphen at each interior position', () => {
    expect(hyphenation('abc', ctx)).toEqual(['a-bc', 'ab-c']);
  });
  it('removes existing hyphens and never doubles one', () => {
    expect(hyphenation('ab-c', ctx)).toEqual(['a-b-c', 'abc']);
    expect(hyphenation('a-b-c', ctx)).toEqual(['ab-c', 'a-bc']);
  });
  it('emits nothing for a 1-char label', () => {
    expect(hyphenation('a', ctx)).toEqual([]);
  });
  it('works on IDN labels', () => {
    expect(hyphenation('éa', ctx)).toEqual(['é-a']);
  });
});
