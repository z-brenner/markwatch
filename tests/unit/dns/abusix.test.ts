import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DnsAnswer } from '../../../src/core/types';
import { abusixQueryName, parseAbusixTxt } from '../../../src/core/dns/abusix';
import { parseDohJson } from '../../../src/core/dns/doh';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

function fixture(resolver: 'cloudflare' | 'google', ip: string): DnsAnswer {
  const name = abusixQueryName(ip);
  if (!name) throw new Error('bad ip');
  const a = parseDohJson(fx(`doh/${resolver}/${name}_TXT.json`), resolver, name, 'TXT');
  if (!a) throw new Error('fixture did not parse');
  return a;
}

const txt = (...data: string[]): DnsAnswer => ({
  name: 'q',
  type: 'TXT',
  rcode: 0,
  ad: false,
  answers: data.map((d) => ({ name: 'q', type: 16, ttl: 300, data: d })),
  authority: [],
  resolver: 'google',
});

describe('abusixQueryName', () => {
  it('reverses IPv4 octets', () => {
    expect(abusixQueryName('213.133.116.44')).toBe('44.116.133.213.abuse-contacts.abusix.zone');
  });
  it('reverses all 32 IPv6 nibbles', () => {
    expect(abusixQueryName('2001:4860:4860::8888')).toBe('8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone');
  });
  it('returns null for anything that is not an IP', () => {
    for (const bad of ['', 'example.com', '1.2.3', '::g', '8.8.8.8.abuse-contacts.abusix.zone']) expect(abusixQueryName(bad)).toBeNull();
  });
});

describe('parseAbusixTxt on real fixtures', () => {
  it.each(['cloudflare', 'google'] as const)('%s: 8.8.8.8 → Google', (r) => {
    expect(parseAbusixTxt(fixture(r, '8.8.8.8'))).toEqual(['network-abuse@google.com']);
  });
  it.each(['cloudflare', 'google'] as const)('%s: Hetzner', (r) => {
    expect(parseAbusixTxt(fixture(r, '213.133.116.44'))).toEqual(['abuse@hetzner.com']);
  });
  it.each(['cloudflare', 'google'] as const)('%s: IPv6, a real comma-separated list', (r) => {
    expect(parseAbusixTxt(fixture(r, '2001:4860:4860::8888'))).toEqual(['arin-contact@google.com', 'network-abuse@google.com']);
  });
});

describe('parseAbusixTxt edge cases', () => {
  it('splits comma-separated lists, trims, lowercases and dedupes', () => {
    expect(parseAbusixTxt(txt('Abuse@Example.com, noc@example.net ,abuse@example.com', 'abuse@example.org'))).toEqual(['abuse@example.com', 'noc@example.net', 'abuse@example.org']);
  });
  it('drops implausible entries', () => {
    expect(parseAbusixTxt(txt('not-an-email, @x.com, a@b, <script>@x.com, ok@example.com'))).toEqual(['ok@example.com']);
  });
  it('returns [] for NXDOMAIN or no TXT data', () => {
    expect(parseAbusixTxt({ ...txt('a@example.com'), rcode: 3 })).toEqual([]);
    expect(parseAbusixTxt(txt())).toEqual([]);
  });
  it('ignores non-TXT records', () => {
    const a = txt('a@example.com');
    a.answers.push({ name: 'q', type: 5, ttl: 1, data: 'b@example.com' });
    expect(parseAbusixTxt(a)).toEqual(['a@example.com']);
  });
});
