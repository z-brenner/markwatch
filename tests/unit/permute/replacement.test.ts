import { describe, expect, it } from 'vitest';
import { replacement } from '../../../src/core/permute/techniques/replacement';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('replacement', () => {
  it('replaces a character with every other character of [a-z0-9-]', () => {
    const out = replacement('a', ctx);
    expect(out).toHaveLength(36);
    expect(out[0]).toBe('b');
    expect(out[25]).toBe('0');
    expect(out[35]).toBe('-');
    expect(out).not.toContain('a');
  });
  it('is position-major', () => {
    const out = replacement('ab', ctx);
    expect(out).toHaveLength(72);
    expect(out.slice(0, 3)).toEqual(['bb', 'cb', 'db']);
    expect(out[36]).toBe('aa');
    expect(out[71]).toBe('a-');
  });
  it('replaces IDN characters too', () => {
    expect(replacement('é', ctx)).toHaveLength(37);
  });
});
