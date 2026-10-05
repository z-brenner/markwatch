import { describe, expect, it } from 'vitest';
import { tldSwap } from '../../../src/core/permute/techniques/tld-swap';

describe('tld-swap', () => {
  it('returns every configured TLD except the current suffix, deduped, in list order', () => {
    const ctx = { suffix: 'com', keyboards: [], tlds: ['com', 'net', 'org', 'net', 'co.uk'], dictionary: [] };
    expect(tldSwap('acme', ctx)).toEqual(['net', 'org', 'co.uk']);
  });
  it('compares multi-label suffixes whole', () => {
    const ctx = { suffix: 'co.uk', keyboards: [], tlds: ['uk', 'co.uk', 'com'], dictionary: [] };
    expect(tldSwap('acme', ctx)).toEqual(['uk', 'com']);
  });
});
