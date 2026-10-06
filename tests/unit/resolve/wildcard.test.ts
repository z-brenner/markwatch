import { describe, expect, it } from 'vitest';
import type { DnsAnswer } from '../../../src/core/types';
import { isWildcard, wildcardProbeName } from '../../../src/core/resolve/wildcard';

const answer = (rcode: number, records: [number, string][]): DnsAnswer => ({
  name: 'mw-x.acme.com',
  type: 'A',
  rcode,
  ad: false,
  answers: records.map(([type, data]) => ({ name: 'mw-x.acme.com', type, ttl: 60, data })),
  authority: [],
  resolver: 'cloudflare',
});

describe('wildcardProbeName', () => {
  it('is mw- plus 12 lowercase alphanumerics under the domain', () => {
    for (let i = 0; i < 50; i++) expect(wildcardProbeName('Acme.com.')).toMatch(/^mw-[a-z0-9]{12}\.acme\.com$/);
  });
  it('is deterministic with an injected random source', () => {
    expect(wildcardProbeName('acme.com', () => 0)).toBe('mw-aaaaaaaaaaaa.acme.com');
    expect(wildcardProbeName('acme.com', () => 0.999999)).toBe('mw-999999999999.acme.com');
  });
  it('clamps out-of-range or broken random values', () => {
    expect(wildcardProbeName('acme.com', () => 1)).toBe('mw-999999999999.acme.com');
    expect(wildcardProbeName('acme.com', () => -3)).toBe('mw-aaaaaaaaaaaa.acme.com');
    expect(wildcardProbeName('acme.com', () => Number.NaN)).toBe('mw-aaaaaaaaaaaa.acme.com');
  });
});

describe('isWildcard', () => {
  it('is true for NOERROR with an A or AAAA answer (also behind a CNAME)', () => {
    expect(isWildcard(answer(0, [[1, '192.0.2.1']]))).toBe(true);
    expect(isWildcard(answer(0, [[28, '2001:db8::1']]))).toBe(true);
    expect(isWildcard(answer(0, [[5, 'park.example.net'], [1, '192.0.2.1']]))).toBe(true);
  });
  it('is false for NXDOMAIN, empty answers, CNAME only, or junk data', () => {
    expect(isWildcard(answer(3, []))).toBe(false);
    expect(isWildcard(answer(0, []))).toBe(false);
    expect(isWildcard(answer(0, [[5, 'x.example.net']]))).toBe(false);
    expect(isWildcard(answer(0, [[1, 'not-an-ip']]))).toBe(false);
    expect(isWildcard(answer(2, [[1, '192.0.2.1']]))).toBe(false);
  });
});
