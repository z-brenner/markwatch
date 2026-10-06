import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS } from '../../../src/data/allowlist';
import {
  BUNDLED_BOOTSTRAP,
  icannLookupUrl,
  parseBootstrapFile,
  rdapDomainTarget,
  rdapIpTarget,
  type RdapBootstrap,
} from '../../../src/core/rdap/bootstrap';

describe('rdapDomainTarget with the bundled bootstrap', () => {
  it.each([
    ['example.com', 'https://rdap.verisign.com/com/v1/'],
    ['wikipedia.org', 'https://rdap.publicinterestregistry.org/rdap/'],
    ['google.info', 'https://rdap.identitydigital.services/rdap/'],
    ['google.ai', 'https://rdap.identitydigital.services/rdap/'],
    ['bbc.co.uk', 'https://rdap.nominet.uk/uk/'],
    ['web.dev', 'https://pubapi.registry.google/rdap/'],
    ['abc.xyz', 'https://rdap.centralnic.com/xyz/'],
  ])('%s → %s', (domain, server) => {
    expect(rdapDomainTarget(domain)).toEqual({ kind: 'ok', server, url: `${server}domain/${domain}` });
  });

  it('normalizes case and a trailing dot', () => {
    expect(rdapDomainTarget('Example.COM.')).toMatchObject({ kind: 'ok', url: 'https://rdap.verisign.com/com/v1/domain/example.com' });
  });

  it('routes IDN TLDs by their A-label', () => {
    const t = rdapDomainTarget('example.xn--kpry57d');
    expect(t).toMatchObject({ kind: 'ok', server: 'https://ccrdap.twnic.tw/taiwan/' });
  });

  it('every bundled base URL is https and in the CSP allowlist', () => {
    for (const file of [BUNDLED_BOOTSTRAP.dns, BUNDLED_BOOTSTRAP.ipv4, BUNDLED_BOOTSTRAP.ipv6]) {
      for (const [, urls] of file.services) for (const u of urls) expect(ALLOWED_HOSTS.has(new URL(u).hostname), u).toBe(true);
    }
  });

  it.each(['io', 'co', 'de', 'us', 'eu', 'me', 'jp', 'cn'])('.%s has no RDAP: unsupported with a manual link', (tld) => {
    const t = rdapDomainTarget(`acme.${tld}`);
    expect(t.kind).toBe('unsupported');
    if (t.kind !== 'unsupported') return;
    expect(t.reason).toContain(`.${tld}`);
    expect(t.reason).toMatch(/says nothing about whether/);
    expect(t.manualUrl).toMatch(/^https:\/\//);
  });

  it('uses the registry WHOIS map where known, else the IANA root-zone page', () => {
    expect(rdapDomainTarget('acme.de')).toMatchObject({ manualUrl: 'https://webwhois.denic.de/?lang=en' });
    expect(rdapDomainTarget('acme.jp')).toMatchObject({ manualUrl: 'https://whois.jprs.jp/en/' });
    expect(rdapDomainTarget('acme.io')).toMatchObject({ manualUrl: 'https://www.iana.org/domains/root/db/io.html' });
  });

  it('treats an http-only service (.kg, .mg) as unsupported', () => {
    const t = rdapDomainTarget('acme.kg');
    expect(t).toMatchObject({ kind: 'unsupported', manualUrl: 'https://www.iana.org/domains/root/db/kg.html' });
    if (t.kind === 'unsupported') expect(t.reason).toMatch(/plain http/);
  });

  it.each(['', '.', 'exa mple.com', '-bad.com', 'a..b', 'x'.repeat(300), 'evil.com/../../x', 'café.com'])('rejects invalid input %j', (bad) => {
    expect(rdapDomainTarget(bad).kind).toBe('unsupported');
  });
});

describe('rdapDomainTarget longest-suffix matching (RFC 9224)', () => {
  const boot: RdapBootstrap = {
    dns: {
      publication: 'test',
      services: [
        [['uk'], ['https://uk.example/']],
        [['co.uk'], ['https://co-uk.example/']],
        [['com'], ['https://a.example/', 'https://b.example/']],
      ],
    },
    ipv4: { publication: 'test', services: [] },
    ipv6: { publication: 'test', services: [] },
  };
  it('prefers the multi-label entry', () => {
    expect(rdapDomainTarget('bbc.co.uk', boot)).toMatchObject({ server: 'https://co-uk.example/' });
    expect(rdapDomainTarget('www.bbc.co.uk', boot)).toMatchObject({ server: 'https://co-uk.example/' });
    expect(rdapDomainTarget('nhs.uk', boot)).toMatchObject({ server: 'https://uk.example/' });
  });
  it('uses the first base URL', () => {
    expect(rdapDomainTarget('x.com', boot)).toMatchObject({ url: 'https://a.example/domain/x.com' });
  });
});

describe('rdapIpTarget', () => {
  it.each([
    ['8.8.8.8', 'https://rdap.arin.net/registry/'],
    ['193.0.6.139', 'https://rdap.db.ripe.net/'],
    ['1.1.1.1', 'https://rdap.apnic.net/'],
    ['41.1.1.1', 'https://rdap.afrinic.net/rdap/'],
    ['2606:4700:4700::1111', 'https://rdap.arin.net/registry/'],
    ['2001:4860:4860::8888', 'https://rdap.arin.net/registry/'],
    ['2a00:1450::1', 'https://rdap.db.ripe.net/'],
  ])('%s → %s', (ip, server) => {
    expect(rdapIpTarget(ip)).toEqual({ kind: 'ok', server, url: `${server}ip/${ip}` });
  });

  it('routes IPv4-mapped IPv6 as IPv4', () => {
    expect(rdapIpTarget('::ffff:8.8.8.8')).toMatchObject({ kind: 'ok', url: 'https://rdap.arin.net/registry/ip/8.8.8.8' });
  });

  it.each(['10.0.0.1', '127.0.0.1', '192.168.1.1', '172.20.0.1', '100.64.1.1', '192.0.2.10', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '2001:db8::1'])('private/reserved %s is unsupported', (ip) => {
    const t = rdapIpTarget(ip);
    expect(t.kind).toBe('unsupported');
    if (t.kind === 'unsupported') expect(t.manualUrl).toBe(`https://www.iana.org/whois?q=${encodeURIComponent(ip)}`);
  });

  it.each(['', 'example.com', '1.2.3', '999.1.1.1', '8.8.8.8/24'])('invalid %j is unsupported', (ip) => {
    expect(rdapIpTarget(ip).kind).toBe('unsupported');
  });

  it('picks the longest matching prefix', () => {
    const boot: RdapBootstrap = {
      dns: { publication: '', services: [] },
      ipv4: {
        publication: '',
        services: [
          [['8.0.0.0/8'], ['https://wide.example/']],
          [['8.8.8.0/24'], ['https://narrow.example/']],
        ],
      },
      ipv6: { publication: '', services: [[['2000::/3'], ['https://v6wide.example/']], [['2001:4800::/23'], ['https://v6narrow.example/']]] },
    };
    expect(rdapIpTarget('8.8.8.8', boot)).toMatchObject({ server: 'https://narrow.example/' });
    expect(rdapIpTarget('8.8.4.4', boot)).toMatchObject({ server: 'https://wide.example/' });
    expect(rdapIpTarget('2001:4860::1', boot)).toMatchObject({ server: 'https://v6narrow.example/' });
    expect(rdapIpTarget('2a00::1', boot)).toMatchObject({ server: 'https://v6wide.example/' });
  });
});

describe('parseBootstrapFile', () => {
  it('accepts IANA’s format, keeps https only and adds the trailing slash', () => {
    const f = parseBootstrapFile({
      version: '1.0',
      publication: '2026-09-30T23:00:03Z',
      services: [
        [['COM', 'net'], ['http://rdap.example/x', 'https://rdap.example/x']],
        [['kg'], ['http://only-http.example/']],
      ],
    });
    expect(f).toEqual({
      publication: '2026-09-30T23:00:03Z',
      services: [
        [['com', 'net'], ['https://rdap.example/x/']],
        [['kg'], []],
      ],
    });
  });
  it('survives hostile shapes', () => {
    for (const bad of [null, 1, 'x', [], {}, { services: 'x' }]) expect(parseBootstrapFile(bad)).toBeNull();
    expect(parseBootstrapFile({ services: [null, 1, [[1, 2], ['https://x/']], [['a'], 'x'], [['ok'], ['javascript:alert(1)', 'https://ok.example/']]] })).toEqual({
      publication: '',
      services: [[['ok'], ['https://ok.example/']]],
    });
  });
});

describe('icannLookupUrl', () => {
  it('encodes the domain', () => {
    expect(icannLookupUrl('example.com')).toBe('https://lookup.icann.org/en/lookup?name=example.com');
    expect(icannLookupUrl('a&b')).toBe('https://lookup.icann.org/en/lookup?name=a%26b');
  });
});
