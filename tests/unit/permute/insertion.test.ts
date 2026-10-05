import { describe, expect, it } from 'vitest';
import { insertion } from '../../../src/core/permute/techniques/insertion';
import type { KeyboardLayout } from '../../../src/core/types';

const ctx = (keyboards: KeyboardLayout[]) => ({ suffix: 'com', keyboards, tlds: [], dictionary: [] });

describe('insertion', () => {
  it('inserts each neighbour before and after the character', () => {
    expect(insertion('a', ctx(['qwerty']))).toEqual(['qa', 'aq', 'wa', 'aw', 'sa', 'as', 'za', 'az']);
  });
  it('covers every character, including the last', () => {
    const out = insertion('ab', ctx(['qwerty']));
    expect(out).toContain('avb'); // before 'b'
    expect(out).toContain('abv'); // after 'b'
    expect(out).toHaveLength(16);
  });
  it('dedupes results reachable from two positions', () => {
    // 'q' and 'w' are neighbours: "qw"+"w" after q equals "q"+"w" before w.
    const out = insertion('qw', ctx(['qwerty']));
    expect(new Set(out).size).toBe(out.length);
    expect(out).toContain('qww');
  });
  it('emits nothing without a layout', () => {
    expect(insertion('acme', ctx([]))).toEqual([]);
  });
});
