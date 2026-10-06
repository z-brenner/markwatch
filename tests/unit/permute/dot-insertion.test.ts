import { describe, expect, it } from 'vitest';
import { dotInsertion } from '../../../src/core/permute/techniques/dot-insertion';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('dot-insertion', () => {
  it('inserts a dot at interior positions, never before the last character', () => {
    expect(dotInsertion('acme', ctx)).toEqual(['a.cme', 'ac.me']);
    expect(dotInsertion('abc', ctx)).toEqual(['a.bc']);
  });
  it('emits nothing for short labels', () => {
    expect(dotInsertion('ab', ctx)).toEqual([]);
    expect(dotInsertion('a', ctx)).toEqual([]);
  });
  it('never puts a dot next to a hyphen', () => {
    expect(dotInsertion('a-bcd', ctx)).toEqual(['a-b.cd']);
  });
});
