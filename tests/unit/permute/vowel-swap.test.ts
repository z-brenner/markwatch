import { describe, expect, it } from 'vitest';
import { vowelSwap } from '../../../src/core/permute/techniques/vowel-swap';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('vowel-swap', () => {
  it('replaces a vowel with each other vowel', () => {
    expect(vowelSwap('bat', ctx)).toEqual(['bet', 'bit', 'bot', 'but']);
  });
  it('handles every vowel position, in order', () => {
    expect(vowelSwap('ae', ctx)).toEqual(['ee', 'ie', 'oe', 'ue', 'aa', 'ai', 'ao', 'au']);
  });
  it('emits nothing without vowels', () => {
    expect(vowelSwap('xyz', ctx)).toEqual([]);
    expect(vowelSwap('y', ctx)).toEqual([]);
  });
  it('treats accented vowels as non-vowels', () => {
    expect(vowelSwap('é', ctx)).toEqual([]);
  });
});
