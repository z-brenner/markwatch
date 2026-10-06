import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DnsAnswer, LookupResult, RdapDomain } from '../../../src/core/types';
import { decideVerdict } from '../../../src/core/resolve/verdict';
import { parseDohJson } from '../../../src/core/dns/doh';
import { parseRdapDomain } from '../../../src/core/rdap/parse';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const AT = '2026-10-05T00:00:00.000Z';

const dns = (rcode: number, answers: DnsAnswer['answers'] = [], extra: Partial<DnsAnswer> = {}): DnsAnswer => ({
  name: 'acme-login.com',
  type: 'NS',
  rcode,
  ad: false,
  answers,
  authority: [],
  resolver: 'cloudflare',
  ...extra,
});
const nsOk = (data: DnsAnswer): LookupResult<DnsAnswer> => ({ status: 'ok', kind: 'dns', query: `${data.name} NS`, source: 'cloudflare-dns.com', at: AT, data });
const nsManual = (data: DnsAnswer): LookupResult<DnsAnswer> => ({ status: 'manual', kind: 'dns', query: `${data.name} NS`, source: 'manual', at: AT, data, pastedText: '…' });
const nsBlocked: LookupResult<DnsAnswer> = { status: 'blocked', kind: 'dns', query: 'acme-login.com NS', source: 'cloudflare-dns.com', at: AT, reason: 'timeout', detail: 'no response in 10 s' };
const nsNotFound: LookupResult<DnsAnswer> = { status: 'not_found', kind: 'dns', query: 'acme-login.com NS', source: 'cloudflare-dns.com', at: AT, evidence: 'Status 3' };

const domain = (status: string[] = ['client transfer prohibited']): RdapDomain => ({ ldhName: 'acme-login.com', status, nameservers: [], redactedFields: [], server: 'https://rdap.verisign.com/com/v1/' });
const rdapOk = (d: RdapDomain): LookupResult<RdapDomain> => ({ status: 'ok', kind: 'rdap-domain', query: d.ldhName, source: 'rdap.verisign.com', at: AT, data: d });
const rdapManual = (d: RdapDomain): LookupResult<RdapDomain> => ({ status: 'manual', kind: 'rdap-domain', query: d.ldhName, source: 'manual', at: AT, data: d, pastedText: '{}' });
const rdapNotFound: LookupResult<RdapDomain> = { status: 'not_found', kind: 'rdap-domain', query: 'acme-login.com', source: 'rdap.verisign.com', at: AT, evidence: 'HTTP 404' };
const rdapBlocked: LookupResult<RdapDomain> = { status: 'blocked', kind: 'rdap-domain', query: 'acme-login.com', source: 'rdap.nic.io', at: AT, reason: 'unsupported', detail: 'No RDAP service for .io' };

const NS_REC = (owner = 'acme-login.com', data = 'ns1.parkingcrew.net') => ({ name: owner, type: 2, ttl: 300, data });
const SOA_REC = { name: 'com', type: 6, ttl: 900, data: 'a.gtld-servers.net. nstld.verisign-grs.com. 1 1800 900 604800 900' };

describe('decideVerdict — PLAN §6.1 rows', () => {
  it('RDAP ok → registered, citing the registry and status', () => {
    const v = decideVerdict({ rdap: rdapOk(domain()) });
    expect(v.verdict).toBe('registered');
    expect(v.reason).toContain('rdap.verisign.com');
    expect(v.reason).toContain('client transfer prohibited');
  });

  it.each([
    ['client hold', 'clientHold'],
    ['serverHold', 'serverHold'],
    ['redemption period', 'redemptionPeriod'],
    ['pending delete', 'pendingDelete'],
  ])('RDAP ok with status %j → registered, and says %s', (status, word) => {
    const v = decideVerdict({ rdap: rdapOk(domain([status])) });
    expect(v.verdict).toBe('registered');
    expect(v.reason).toContain(word);
    expect(v.reason).toMatch(/may not resolve/);
  });

  it('RDAP is authoritative over DNS: ok beats NXDOMAIN', () => {
    expect(decideVerdict({ rdap: rdapOk(domain(['client hold'])), ns: nsOk(dns(3)) }).verdict).toBe('registered');
  });

  it('RDAP not_found → available, even when DNS was blocked', () => {
    const v = decideVerdict({ rdap: rdapNotFound, ns: nsBlocked });
    expect(v.verdict).toBe('available');
    expect(v.reason).toMatch(/^Registry RDAP returned 404/);
  });

  it('RDAP not_found beats a (stale) NS answer', () => {
    expect(decideVerdict({ rdap: rdapNotFound, ns: nsOk(dns(0, [NS_REC()])) }).verdict).toBe('available');
  });

  it('NS ok, rcode 0, NS record owned by the queried name → registered', () => {
    const v = decideVerdict({ ns: nsOk(dns(0, [NS_REC(), NS_REC('acme-login.com.', 'ns2.parkingcrew.net')])) });
    expect(v.verdict).toBe('registered');
    expect(v.reason).toContain('ns1.parkingcrew.net, ns2.parkingcrew.net');
  });

  it('owner-name comparison ignores case and the trailing dot', () => {
    expect(decideVerdict({ ns: nsOk(dns(0, [NS_REC('ACME-LOGIN.COM.')], { name: 'acme-login.com.' })) }).verdict).toBe('registered');
  });

  it('NS records owned by another name do not count', () => {
    expect(decideVerdict({ ns: nsOk(dns(0, [NS_REC('other.com')])) }).verdict).toBe('probably_unregistered');
  });

  it('NS ok, rcode 0, no NS answers (SOA in authority) → probably_unregistered', () => {
    const v = decideVerdict({ ns: nsOk(dns(0, [], { authority: [SOA_REC] })) });
    expect(v.verdict).toBe('probably_unregistered');
    expect(v.reason).toContain('SOA for com');
  });

  it('NS ok, rcode 3 → not_delegated, and the reason says it is not proof', () => {
    const v = decideVerdict({ ns: nsOk(dns(3, [], { authority: [SOA_REC] })) });
    expect(v.verdict).toBe('not_delegated');
    expect(v.reason).toMatch(/not proof that it is unregistered/);
    expect(v.reason).toMatch(/clientHold|serverHold/);
    expect(v.reason).toMatch(/redemption/);
    expect(v.reason).toMatch(/without nameservers/);
  });

  it('NS not_found (collector mapped NXDOMAIN to not_found) → not_delegated, never available', () => {
    const v = decideVerdict({ ns: nsNotFound });
    expect(v.verdict).toBe('not_delegated');
    expect(v.reason).toMatch(/not proof/);
  });

  it('NS ok, rcode 2 → registered_broken_dns, with the resolver comment', () => {
    const v = decideVerdict({ ns: nsOk(dns(2, [], { comment: 'EDE(9): DNSKEY Missing' })) });
    expect(v.verdict).toBe('registered_broken_dns');
    expect(v.reason).toMatch(/lame delegation or DNSSEC failure/);
    expect(v.reason).toContain('EDE(9)');
  });

  it('other rcodes (REFUSED) → unknown', () => {
    const v = decideVerdict({ ns: nsOk(dns(5)) });
    expect(v.verdict).toBe('unknown');
    expect(v.reason).toContain('REFUSED');
  });

  it('NS blocked and no decisive RDAP → blocked, never unregistered', () => {
    const v = decideVerdict({ ns: nsBlocked });
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('timeout');
    expect(v.reason).toMatch(/not "unregistered"/);
  });

  it('NS blocked and RDAP blocked/unsupported → blocked', () => {
    const v = decideVerdict({ ns: nsBlocked, rdap: rdapBlocked });
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toContain('No RDAP service for .io');
  });

  it('RDAP blocked falls through to the NS answer', () => {
    expect(decideVerdict({ ns: nsOk(dns(3)), rdap: rdapBlocked }).verdict).toBe('not_delegated');
  });

  it('nothing at all → unknown', () => {
    expect(decideVerdict({}).verdict).toBe('unknown');
  });

  it('manual results count like ok', () => {
    const manual = decideVerdict({ rdap: rdapManual(domain()) });
    expect(manual.verdict).toBe('registered');
    expect(manual.reason).toContain('pasted by the user');
    expect(decideVerdict({ ns: nsManual(dns(0, [NS_REC()])) }).verdict).toBe('registered');
    expect(decideVerdict({ ns: nsManual(dns(3)) }).verdict).toBe('not_delegated');
  });
});

describe('decideVerdict on real fixtures', () => {
  const nsFrom = (resolver: 'cloudflare' | 'google', name: string): LookupResult<DnsAnswer> => {
    const data = parseDohJson(fx(`doh/${resolver}/${name}_NS.json`), resolver, name, 'NS');
    if (!data) throw new Error('fixture');
    return nsOk(data);
  };

  it.each(['cloudflare', 'google'] as const)('%s: example.com → registered', (r) => {
    expect(decideVerdict({ ns: nsFrom(r, 'example.com') }).verdict).toBe('registered');
  });
  it.each(['cloudflare', 'google'] as const)('%s: NXDOMAIN → not_delegated', (r) => {
    expect(decideVerdict({ ns: nsFrom(r, 'markwatch-nonexistent-7f3kq9.com') }).verdict).toBe('not_delegated');
  });
  it.each(['cloudflare', 'google'] as const)('%s: dnssec-failed.org → registered_broken_dns', (r) => {
    expect(decideVerdict({ ns: nsFrom(r, 'dnssec-failed.org') }).verdict).toBe('registered_broken_dns');
  });
  it('Verisign RDAP for example.com → registered', () => {
    const d = parseRdapDomain(fx('rdap/domain/example.com.json'), 'https://rdap.verisign.com/com/v1/');
    if (!d) throw new Error('fixture');
    expect(decideVerdict({ rdap: rdapOk(d) }).verdict).toBe('registered');
  });
});
