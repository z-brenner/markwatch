import { describe, expect, it } from 'vitest';
import { asArray, cleanText, hostHasSuffix, isPlausibleEmail, normalizeEmail, normalizeHost, toIsoUtc } from '../../../src/core/net/clean';

describe('cleanText', () => {
  it('trims, strips control and bidi characters, and caps length', () => {
    expect(cleanText('  a\u0000b\u202ec\u200b  ')).toBe('abc');
    expect(cleanText('x'.repeat(5000), 10)).toBe('x'.repeat(10));
    expect(cleanText('x'.repeat(10_000_000))?.length).toBe(1000);
  });
  it('returns undefined for empty and non-string values', () => {
    for (const v of ['', '   ', null, undefined, 1, {}, []]) expect(cleanText(v)).toBeUndefined();
  });
});

describe('normalizeHost / hostHasSuffix', () => {
  it('lowercases and strips one trailing dot', () => {
    expect(normalizeHost('HERA.NS.Cloudflare.COM.')).toBe('hera.ns.cloudflare.com');
    expect(normalizeHost('.')).toBeUndefined();
    expect(normalizeHost(42)).toBeUndefined();
  });
  it('matches label-aligned suffixes only', () => {
    expect(hostHasSuffix('hera.ns.cloudflare.com', 'ns.cloudflare.com')).toBe(true);
    expect(hostHasSuffix('ns.cloudflare.com.', '.ns.cloudflare.com')).toBe(true);
    expect(hostHasSuffix('xns.cloudflare.com', 'ns.cloudflare.com')).toBe(false);
    expect(hostHasSuffix('cloudflare.com', 'ns.cloudflare.com')).toBe(false);
    expect(hostHasSuffix('anything', '')).toBe(false);
  });
});

describe('emails', () => {
  it('accepts plausible addresses and normalizes them', () => {
    expect(normalizeEmail(' Abuse@Example.COM ')).toBe('abuse@example.com');
    expect(normalizeEmail('mailto:abuse@example.com')).toBe('abuse@example.com');
    expect(normalizeEmail('<abuse@example.com>')).toBe('abuse@example.com');
  });
  it.each(['', 'abuse', 'abuse@', '@example.com', 'a@b', 'a b@example.com', 'a@exa mple.com', 'a@-x.com', `${'a'.repeat(250)}@example.com`, 'REDACTED FOR PRIVACY'])('rejects %j', (s) => {
    expect(normalizeEmail(s)).toBeUndefined();
    expect(isPlausibleEmail(s)).toBe(false);
  });
});

describe('toIsoUtc', () => {
  it.each([
    ['1995-08-14T04:00:00Z', '1995-08-14T04:00:00.000Z'],
    ['2025-10-29T03:51:11.009091Z', '2025-10-29T03:51:11.009Z'],
    ['2014-03-20T12:59:17.0Z', '2014-03-20T12:59:17.000Z'],
    ['2026-08-19T14:34:18-04:00', '2026-08-19T18:34:18.000Z'],
    ['2020-12-09T13:12:35+0100', '2020-12-09T12:12:35.000Z'],
    ['2026-08-05T23:00:30', '2026-08-05T23:00:30.000Z'],
    ['2001-01-13 00:12:14', '2001-01-13T00:12:14.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
  ])('%s → %s', (input, want) => expect(toIsoUtc(input)).toBe(want));

  it.each(['', 'yesterday', '2023-02-29', '2024-13-01', '2024-01-01T25:00:00Z', '1', '2024-01-01T00:00:00+25:00', '2024-01-01T00:00:00Zjunk', null, 1700000000])('rejects %j', (v) =>
    expect(toIsoUtc(v)).toBeUndefined(),
  );
});

describe('asArray', () => {
  it('returns [] for non-arrays and caps arrays', () => {
    expect(asArray({ length: 3 })).toEqual([]);
    expect(asArray(new Array(5000).fill(1), 10)).toHaveLength(10);
  });
});
