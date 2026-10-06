import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DnsAnswer, RRType } from '../../../src/core/types';
import {
  aaaaRecords,
  aRecords,
  decodeTxt,
  dohUrl,
  manualDnsUrl,
  mxHosts,
  nsHosts,
  parseDohJson,
  recordsOfType,
  txtRecords,
} from '../../../src/core/dns/doh';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const RESOLVERS = ['cloudflare', 'google'] as const;

function load(resolver: (typeof RESOLVERS)[number], name: string, type: RRType): DnsAnswer {
  const a = parseDohJson(fx(`doh/${resolver}/${name}_${type}.json`), resolver, name, type);
  if (!a) throw new Error(`fixture ${resolver}/${name}_${type} did not parse`);
  return a;
}

describe('dohUrl / manualDnsUrl', () => {
  it('builds the Cloudflare JSON URL with the Accept header (ct= returns 400)', () => {
    expect(dohUrl('cloudflare', 'example.com', 'NS')).toEqual({
      url: 'https://cloudflare-dns.com/dns-query?name=example.com&type=NS',
      headers: { accept: 'application/dns-json' },
    });
  });
  it('builds the Google URL without headers', () => {
    expect(dohUrl('google', 'example.com', 'AAAA')).toEqual({ url: 'https://dns.google/resolve?name=example.com&type=AAAA&edns_client_subnet=0.0.0.0/0', headers: {} });
  });
  it('percent-encodes the name so it cannot inject parameters', () => {
    const { url } = dohUrl('google', 'evil.com&type=TXT#x', 'A');
    expect(url).toBe('https://dns.google/resolve?name=evil.com%26type%3DTXT%23x&type=A&edns_client_subnet=0.0.0.0/0');
    expect(new URL(url).searchParams.getAll('type')).toEqual(['A']);
  });
  it('links to Google’s human-readable page', () => {
    expect(manualDnsUrl('xn--caf-dma.com', 'MX')).toBe('https://dns.google/query?name=xn--caf-dma.com&rr_type=MX');
  });
});

describe('parseDohJson on real fixtures', () => {
  it.each(RESOLVERS)('%s: example.com NS', (r) => {
    const a = load(r, 'example.com', 'NS');
    expect(a).toMatchObject({ name: 'example.com', type: 'NS', rcode: 0, resolver: r });
    expect(nsHosts(a).sort()).toEqual(['elliott.ns.cloudflare.com', 'hera.ns.cloudflare.com']);
    // Owner names are normalized for both resolvers (Google adds a trailing dot).
    expect(a.answers.every((x) => x.name === 'example.com')).toBe(true);
  });

  it.each(RESOLVERS)('%s: example.com A and AAAA', (r) => {
    expect(aRecords(load(r, 'example.com', 'A')).length).toBeGreaterThan(0);
    expect(aRecords(load(r, 'example.com', 'A')).every((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip))).toBe(true);
    const v6 = aaaaRecords(load(r, 'example.com', 'AAAA'));
    expect(v6.length).toBeGreaterThan(0);
    expect(v6.every((ip) => ip.includes(':'))).toBe(true);
  });

  it.each(RESOLVERS)('%s: example.com publishes a null MX ("0 .") which yields no mail host', (r) => {
    const a = load(r, 'example.com', 'MX');
    expect(recordsOfType(a, 'MX').map((x) => x.data)).toEqual(['0 .']);
    expect(mxHosts(a)).toEqual([]);
  });

  it.each(RESOLVERS)('%s: example.com TXT is unquoted identically for both resolvers', (r) => {
    expect(txtRecords(load(r, 'example.com', 'TXT')).sort()).toEqual(['_k2n1y4vw3qtb4skdx9e7dxt97qrmmq9', 'v=spf1 -all']);
  });

  it.each(RESOLVERS)('%s: NXDOMAIN keeps rcode 3 and the TLD SOA in authority', (r) => {
    const a = load(r, 'markwatch-nonexistent-7f3kq9.com', 'NS');
    expect(a.rcode).toBe(3);
    expect(a.answers).toEqual([]);
    expect(a.authority[0]).toMatchObject({ name: 'com', type: 6 });
  });

  it.each(RESOLVERS)('%s: MX-only domain (pphosted.com)', (r) => {
    expect(mxHosts(load(r, 'pphosted.com', 'MX'))).toEqual(['mx1.proofpoint.com.gslb.pphosted.com', 'mx2.proofpoint.com.gslb.pphosted.com']);
    const a = load(r, 'pphosted.com', 'A');
    expect(a.rcode).toBe(0);
    expect(aRecords(a)).toEqual([]);
    expect(a.authority.map((x) => x.type)).toEqual([6]);
  });

  it('SERVFAIL carries the resolver comment (string[] from Cloudflare, string + EDE from Google)', () => {
    const cf = load('cloudflare', 'dnssec-failed.org', 'NS');
    expect(cf.rcode).toBe(2);
    expect(cf.comment).toMatch(/^EDE\(9\): DNSKEY Missing/);
    const g = load('google', 'dnssec-failed.org', 'NS');
    expect(g.rcode).toBe(2);
    expect(g.comment).toContain('DNSSEC validation failure');
    expect(g.comment).toContain('EDE(9): No DNSKEY matches DS RRs of dnssec-failed.org');
  });

  it('reads the AD bit', () => {
    expect(load('google', 'example.com', 'NS').ad).toBe(true);
    expect(load('cloudflare', 'markwatch-nonexistent-7f3kq9.com', 'NS').ad).toBe(false);
  });
});

describe('TXT decoding', () => {
  it.each([
    ['"v=spf1 -all"', 'v=spf1 -all'],
    ['"a" "b"', 'ab'],
    ['"part one " "part two"', 'part one part two'],
    ['"say \\"hi\\""', 'say "hi"'],
    ['"back\\\\slash"', 'back\\slash'],
    ['"caf\\195\\169"', 'cafÃ©'],
    ['unquoted text', 'unquoted text'],
    ['"unterminated', '"unterminated'],
    ['"a" junk "b"', '"a" junk "b"'],
    ['""', ''],
  ])('%s → %j', (input, want) => expect(decodeTxt(input)).toBe(want));
});

describe('parseDohJson on hostile input', () => {
  it.each([null, undefined, 42, 'Status', [], [{ Status: 0 }], {}, { Status: '0' }, { Status: -1 }, { Status: 1.5 }, { Status: Number.NaN }, { Status: 1e9 }])('returns null for %j', (v) =>
    expect(parseDohJson(v, 'cloudflare', 'x.com', 'A')).toBeNull(),
  );

  it('skips malformed records instead of failing', () => {
    const a = parseDohJson(
      {
        Status: 0,
        AD: 'true',
        Answer: [null, 'x', { type: 1 }, { name: 'x.com', type: '1', data: '1.2.3.4' }, { name: 5, type: 1, data: '1.2.3.4', TTL: -5 }, { name: 'x.com.', type: 1, data: '5.6.7.8', TTL: 1e12 }],
        Authority: 'not an array',
        Comment: { evil: true },
      },
      'google',
      'X.COM.',
      'A',
    );
    expect(a).not.toBeNull();
    expect(a?.ad).toBe(false);
    expect(a?.name).toBe('x.com');
    expect(a?.answers).toEqual([
      { name: '', type: 1, ttl: 0, data: '1.2.3.4' },
      { name: 'x.com', type: 1, ttl: 2 ** 31 - 1, data: '5.6.7.8' },
    ]);
    expect(a?.authority).toEqual([]);
    expect(a?.comment).toBeUndefined();
  });

  it('caps record count and data length', () => {
    const huge = 'x'.repeat(1_000_000);
    const a = parseDohJson({ Status: 0, Answer: Array.from({ length: 10_000 }, () => ({ name: 'x.com', type: 16, data: huge })) }, 'google', 'x.com', 'TXT');
    expect(a?.answers.length).toBe(500);
    expect(a?.answers[0]?.data.length).toBe(16_384);
  });

  it('filters invalid addresses out of A/AAAA helpers', () => {
    const a = parseDohJson(
      { Status: 0, Answer: [{ name: 'x.com', type: 1, data: '999.1.1.1' }, { name: 'x.com', type: 1, data: '1.1.1.1' }, { name: 'x.com', type: 28, data: 'nope' }, { name: 'x.com', type: 28, data: '2001:DB8::1' }] },
      'google',
      'x.com',
      'A',
    ) as DnsAnswer;
    expect(aRecords(a)).toEqual(['1.1.1.1']);
    expect(aaaaRecords(a)).toEqual(['2001:db8::1']);
  });

  it('orders MX hosts by preference and normalizes them', () => {
    const a = parseDohJson(
      { Status: 0, Answer: [{ name: 'x.com', type: 15, data: '20 MX2.Example.NET.' }, { name: 'x.com', type: 15, data: '10 mx1.example.net.' }, { name: 'x.com', type: 15, data: '10 mx1.example.net' }] },
      'google',
      'x.com',
      'MX',
    ) as DnsAnswer;
    expect(mxHosts(a)).toEqual(['mx1.example.net', 'mx2.example.net']);
  });
});
