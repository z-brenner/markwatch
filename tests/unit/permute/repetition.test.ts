import { describe, expect, it } from 'vitest';
import { repetition } from '../../../src/core/permute/techniques/repetition';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('repetition', () => {
  it('doubles each character in order', () => {
    expect(repetition('abc', ctx)).toEqual(['aabc', 'abbc', 'abcc']);
  });
  it('dedupes runs', () => {
    expect(repetition('aa', ctx)).toEqual(['aaa']);
  });
  it('handles a 1-char label', () => {
    expect(repetition('a', ctx)).toEqual(['aa']);
  });
  it('handles hyphens and IDN characters', () => {
    expect(repetition('a-é', ctx)).toEqual(['aa-é', 'a--é', 'a-éé']);
  });
});
