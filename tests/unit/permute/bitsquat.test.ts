import { describe, expect, it } from 'vitest';
import { bitsquat } from '../../../src/core/permute/techniques/bitsquat';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('bitsquat', () => {
  it('flips each bit and keeps only [a-z0-9-]', () => {
    // 'a' = 0x61: ^2 c, ^4 e, ^8 i, ^16 q; ^1 '`', ^32 'A', ^64 '!', ^128 'á' are dropped.
    expect(bitsquat('a', ctx)).toEqual(['c', 'e', 'i', 'q']);
    expect(bitsquat('0', ctx)).toEqual(['1', '2', '4', '8', 'p']);
    expect(bitsquat('-', ctx)).toEqual(['m']);
  });
  it('never emits uppercase or non-LDH characters', () => {
    const out = bitsquat('abc-123', ctx);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) expect(v).toMatch(/^[a-z0-9-]+$/);
    expect(out).not.toContain('Abc-123');
  });
  it('flips the high bit of a Latin-1 letter into ASCII', () => {
    // 'é' = 0xE9; 0xE9 ^ 0x80 = 0x69 'i'.
    expect(bitsquat('café', ctx)).toContain('cafi');
  });
});
