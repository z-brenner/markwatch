import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RdapNetwork } from '../../../src/core/types';
import { inferProviders } from '../../../src/core/resolve/providers';
import { matchParking, PARKING } from '../../../src/config/parking';
import { DNS_PROVIDERS, MAIL_PROVIDERS, WEB_PROVIDERS } from '../../../src/config/providers';
import { parseRdapNetwork } from '../../../src/core/rdap/parse';
import { mxHosts, parseDohJson } from '../../../src/core/dns/doh';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const net = (file: string): RdapNetwork => {
  const n = parseRdapNetwork(fx(`rdap/ip/${file}.json`), 'x');
  if (!n) throw new Error('fixture');
  return n;
};
const empty = { ns: [], mx: [], networks: {}, ips: [] };

describe('inferProviders', () => {
  it('identifies Cloudflare DNS from example.com’s nameservers', () => {
    expect(inferProviders({ ...empty, ns: ['HERA.NS.CLOUDFLARE.COM.', 'elliott.ns.cloudflare.com'] })).toEqual([
      { id: 'cloudflare-dns', name: 'Cloudflare DNS', role: 'dns', evidence: 'NS hera.ns.cloudflare.com, elliott.ns.cloudflare.com end with .ns.cloudflare.com' },
    ]);
  });

  it('matches Route 53 and Azure by pattern', () => {
    const out = inferProviders({ ...empty, ns: ['ns-1234.awsdns-12.org', 'ns1-05.azure-dns.com'] });
    expect(out.map((m) => m.id)).toEqual(['route53', 'azure-dns']);
    expect(out[0]?.evidence).toBe('NS ns-1234.awsdns-12.org matches the Amazon Route 53 nameserver pattern');
  });

  it('distinguishes Google Cloud DNS from other googledomains.com nameservers', () => {
    expect(inferProviders({ ...empty, ns: ['ns-cloud-a1.googledomains.com'] }).map((m) => m.id)).toEqual(['google-cloud-dns', 'google-domains-dns']);
    expect(inferProviders({ ...empty, ns: ['ns1.googledomains.com'] }).map((m) => m.id)).toEqual(['google-domains-dns']);
  });

  it('suffix matches are label-aligned', () => {
    expect(inferProviders({ ...empty, ns: ['ns1.notdomaincontrol.com', 'evil-ns.cloudflare.com.attacker.net'] })).toEqual([]);
  });

  it('marks Cloudflare as a CDN that hides the origin, from real ARIN data', () => {
    const out = inferProviders({ ...empty, ips: ['2606:4700:4700::1111'], networks: { '2606:4700:4700::1111': net('2606_4700_4700__1111') } });
    expect(out).toEqual([
      {
        id: 'cloudflare',
        name: 'Cloudflare',
        role: 'cdn',
        evidence: 'IP 2606:4700:4700::1111 belongs to Cloudflare, Inc. (RDAP network NET6-2606-4700-1)',
        abuseUrl: 'https://abuse.cloudflare.com/',
        hidesOrigin: true,
      },
    ]);
  });

  it('identifies Google from real ARIN data, and ignores IPs without a network', () => {
    const out = inferProviders({ ...empty, ips: ['8.8.8.8', '8.8.4.4', '9.9.9.9'], networks: { '8.8.8.8': net('8.8.8.8'), '8.8.4.4': net('8.8.8.8') } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'google-cloud', role: 'web', evidence: 'IP 8.8.8.8, 8.8.4.4 belong to Google LLC (RDAP network NET-8-8-8-0-2)' });
  });

  it('does not read inherited properties of the networks object', () => {
    expect(inferProviders({ ...empty, ips: ['constructor', '__proto__'], networks: {} })).toEqual([]);
  });

  it('identifies mail from MX (real pphosted.com answer → Proofpoint)', () => {
    const a = parseDohJson(fx('doh/google/pphosted.com_MX.json'), 'google', 'pphosted.com', 'MX');
    const out = inferProviders({ ...empty, mx: a ? mxHosts(a) : [] });
    expect(out.map((m) => [m.id, m.role])).toEqual([['proofpoint', 'mail']]);
  });

  it('Google Workspace and Microsoft 365', () => {
    expect(inferProviders({ ...empty, mx: ['aspmx.l.google.com', 'acme-com.mail.protection.outlook.com'] }).map((m) => m.id)).toEqual(['google-workspace', 'microsoft-365']);
  });

  it('includes a parking match and orders groups dns → parking → web → mail', () => {
    const out = inferProviders({
      ns: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
      mx: ['mx.zoho.com'],
      ips: ['8.8.8.8'],
      networks: { '8.8.8.8': net('8.8.8.8') },
    });
    expect(out.map((m) => m.role)).toEqual(['parking', 'web', 'mail']);
    expect(out[0]).toMatchObject({ id: 'sedo', trademarkComplaintUrl: 'https://sedo.com/us/about-us/policies/ip-complaint-procedure/' });
  });

  it('is deterministic regardless of input order', () => {
    const a = inferProviders({ ...empty, ns: ['ns1.digitalocean.com', 'hera.ns.cloudflare.com'], mx: ['in1-smtp.messagingengine.com', 'aspmx.l.google.com'] });
    const b = inferProviders({ ...empty, ns: ['hera.ns.cloudflare.com', 'ns1.digitalocean.com'], mx: ['aspmx.l.google.com', 'in1-smtp.messagingengine.com'] });
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(a.map((m) => m.id)).toEqual(['cloudflare-dns', 'digitalocean-dns', 'google-workspace', 'fastmail']);
  });

  it('ignores junk and null-MX hosts', () => {
    expect(inferProviders({ ns: ['', '.', 'x'.repeat(10_000)], mx: ['.', ''], networks: {}, ips: [] })).toEqual([]);
  });
});

describe('matchParking', () => {
  it.each([
    [['ns1.sedoparking.com'], 'sedo', true],
    [['ns1.abovedomains.com'], 'above', false],
    [['ns2.above.com'], 'above', false],
    [['ns01.cashparking.com'], 'godaddy-cashparking', true],
    [['ns1.afternic.com'], 'afternic', true],
    [['ns1.dan.com'], 'afternic', true],
    [['ns1.parkingcrew.net'], 'parkingcrew', false],
    [['ns1.bodis.com'], 'bodis', false],
  ])('%j → %s', (ns, id, hasComplaintUrl) => {
    const m = matchParking(ns);
    expect(m?.id).toBe(id);
    expect(m?.role).toBe('parking');
    expect(!!m?.trademarkComplaintUrl).toBe(hasComplaintUrl);
  });

  it('labels Bodis as legacy and maps Dan.com to Afternic’s GoDaddy complaint form', () => {
    expect(matchParking(['ns1.bodis.com'])?.name).toBe('Bodis (legacy — shut down Jan 2026)');
    expect(matchParking(['ns1.dan.com'])?.trademarkComplaintUrl).toBe('https://supportcenter.godaddy.com/ipclaims/trademark');
  });

  it('returns null for non-parking or look-alike nameservers', () => {
    expect(matchParking(['hera.ns.cloudflare.com'])).toBeNull();
    expect(matchParking(['ns1.notsedoparking.com', 'sedoparking.com.evil.net'])).toBeNull();
    expect(matchParking([])).toBeNull();
  });

  it('gives evidence', () => {
    expect(matchParking(['NS1.SEDOPARKING.COM.', 'ns2.sedoparking.com'])?.evidence).toBe('NS ns1.sedoparking.com, ns2.sedoparking.com end with .sedoparking.com');
  });
});

describe('fingerprint tables', () => {
  it('have unique ids and https abuse/complaint URLs', () => {
    const all = [...DNS_PROVIDERS, ...WEB_PROVIDERS, ...MAIL_PROVIDERS];
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(new Set(PARKING.map((p) => p.id)).size).toBe(PARKING.length);
    for (const p of all) if (p.abuseUrl) expect(p.abuseUrl).toMatch(/^https:\/\//);
    for (const p of PARKING) if (p.trademarkComplaintUrl) expect(p.trademarkComplaintUrl).toMatch(/^https:\/\//);
  });
  it('every entry can match something in its role', () => {
    for (const p of DNS_PROVIDERS) expect(!!(p.match.nsSuffix?.length || p.match.nsRegex), p.id).toBe(true);
    for (const p of WEB_PROVIDERS) expect(!!p.match.orgRegex, p.id).toBe(true);
    for (const p of MAIL_PROVIDERS) expect(!!p.match.mxSuffix?.length, p.id).toBe(true);
  });
  it('no regex is global or sticky (stateful lastIndex would break matching)', () => {
    for (const p of [...DNS_PROVIDERS, ...WEB_PROVIDERS]) for (const r of [p.match.nsRegex, p.match.orgRegex]) if (r) expect(r.global || r.sticky, p.id).toBe(false);
  });
  it('Linode is matched before Akamai', () => {
    expect(inferProviders({ ...empty, ips: ['1'], networks: { '1': { cidr: [], abuseEmail: [], server: 'x', org: 'Akamai Technologies, Inc.', name: 'LINODE-US' } } }).map((m) => m.id)).toEqual(['linode']);
    expect(inferProviders({ ...empty, ips: ['1'], networks: { '1': { cidr: [], abuseEmail: [], server: 'x', org: 'Akamai Technologies, Inc.' } } }).map((m) => m.id)).toEqual(['akamai']);
  });
});
