import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRdapNotFound, looksRedacted, parseRdapDomain, parseRdapNetwork } from '../../../src/core/rdap/parse';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const MARKMONITOR_ABUSE = 'abusecomplaints@markmonitor.com';

describe('parseRdapDomain on real registry responses', () => {
  it('Verisign: example.com (thin, uppercase ldhName, empty abuse vCard)', () => {
    const d = parseRdapDomain(fx('rdap/domain/example.com.json'), 'https://rdap.verisign.com/com/v1/');
    expect(d).toEqual({
      ldhName: 'example.com',
      handle: '2336799_DOMAIN_COM-VRSN',
      status: ['client delete prohibited', 'client transfer prohibited', 'client update prohibited'],
      registered: '1995-08-14T04:00:00.000Z',
      expires: '2027-08-13T04:00:00.000Z',
      lastChanged: '2026-08-14T08:01:43.000Z',
      registrar: { name: 'RESERVED-Internet Assigned Numbers Authority', ianaId: '376', abuseEmail: [], abuseTel: [] },
      nameservers: ['elliott.ns.cloudflare.com', 'hera.ns.cloudflare.com'],
      redactedFields: [],
      server: 'https://rdap.verisign.com/com/v1/',
    });
  });

  it('PIR: wikipedia.org (RFC 9537 redaction of the handle, registrar abuse contact)', () => {
    const d = parseRdapDomain(fx('rdap/domain/wikipedia.org.json'), 'pir');
    expect(d?.ldhName).toBe('wikipedia.org');
    expect(d?.unicodeName).toBe('wikipedia.org');
    expect(d?.handle).toBeUndefined();
    expect(d?.redactedFields).toEqual(['Registry Domain ID']);
    expect(d?.registrant).toBeUndefined();
    expect(d?.registered).toBe('2001-01-13T00:12:14.754Z');
    expect(d?.lastChanged).toBe('2026-08-12T08:47:19.410Z');
    // The registrar's "about" link is its RDAP base (application/rdap+json), not a website.
    expect(d?.registrar).toEqual({ name: 'MarkMonitor Inc.', ianaId: '292', abuseEmail: [MARKMONITOR_ABUSE], abuseTel: ['+1.2083895740'] });
    expect(d?.nameservers).toEqual(['ns0.wikimedia.org', 'ns1.wikimedia.org', 'ns2.wikimedia.org']);
  });

  it('Identity Digital: google.info', () => {
    const d = parseRdapDomain(fx('rdap/domain/google.info.json'), 'id');
    expect(d?.status).toContain('server transfer prohibited');
    expect(d?.registrar?.abuseEmail).toEqual([MARKMONITOR_ABUSE]);
    expect(d?.expires).toBe('2027-07-31T23:57:50.566Z');
    expect(d?.nameservers).toHaveLength(4);
  });

  it('Identity Digital: google.ai has an unredacted registrant', () => {
    const d = parseRdapDomain(fx('rdap/domain/google.ai.json'), 'id');
    expect(d?.registrant).toEqual({
      roles: ['registrant', 'technical', 'administrative'],
      name: 'Domain Administrator',
      org: 'Google LLC',
      email: ['dns-admin@google.com'],
      tel: ['+1.6502530000', '+1.6502530001'],
      country: 'US',
      redacted: false,
    });
  });

  it('Nominet: bbc.co.uk (registrant redacted by policy, placeholder email dropped, trailing-dot nameservers)', () => {
    const d = parseRdapDomain(fx('rdap/domain/bbc.co.uk.json'), 'https://rdap.nominet.uk/uk/');
    expect(d?.registrant).toEqual({ roles: ['registrant'], email: [], tel: [], redacted: true });
    expect(d?.redactedFields).toContain('Registrant Name');
    expect(d?.redactedFields).toContain('Registrant Organisation Type');
    expect(d?.registrar).toMatchObject({ name: 'British Broadcasting Corporation', url: 'https://www.bbc.co.uk/', abuseEmail: ['nominet.admins@bbc.co.uk'] });
    expect(d?.registrar?.ianaId).toBeUndefined();
    expect(d?.nameservers).toContain('ddns0.bbc.co.uk');
    expect(d?.nameservers.every((n) => !n.endsWith('.'))).toBe(true);
    expect(d?.lastChanged).toBe('2025-10-29T03:51:11.009Z');
  });

  it('Google Registry: web.dev (array tel type, nested abuse entity)', () => {
    const d = parseRdapDomain(fx('rdap/domain/web.dev.json'), 'g');
    expect(d?.registrar).toMatchObject({ name: 'MarkMonitor Inc.', ianaId: '292', abuseEmail: ['registryescalations@markmonitor.com'], abuseTel: ['+1.2083895740'] });
    expect(d?.registered).toBe('2018-10-29T15:57:39.435Z');
  });

  it('CentralNic: abc.xyz', () => {
    const d = parseRdapDomain(fx('rdap/domain/abc.xyz.json'), 'c');
    expect(d?.registrar).toMatchObject({ ianaId: '292', abuseEmail: [MARKMONITOR_ABUSE] });
    expect(d?.registered).toBe('2014-03-20T12:59:17.000Z');
    expect(d?.status).toEqual(['client transfer prohibited', 'client update prohibited', 'client delete prohibited']);
  });

  it('returns null for the 404 bodies (PIR error object, Verisign empty body)', () => {
    expect(parseRdapDomain(fx('rdap/domain/markwatch-nonexistent-7f3kq9.org.json'), 'x')).toBeNull();
    expect(parseRdapDomain(fx('rdap/domain/markwatch-nonexistent-7f3kq9.com.json'), 'x')).toBeNull();
  });

  it('rejects an IP network object passed as a domain', () => {
    expect(parseRdapDomain(fx('rdap/ip/8.8.8.8.json'), 'x')).toBeNull();
  });
});

describe('parseRdapDomain redaction and hostile input', () => {
  const base = { objectClassName: 'domain', ldhName: 'acme-login.com' };

  it('marks a registrant redacted from marker values and drops those values', () => {
    const d = parseRdapDomain(
      {
        ...base,
        entities: [
          {
            roles: ['registrant'],
            vcardArray: ['vcard', [['fn', {}, 'text', 'REDACTED FOR PRIVACY'], ['org', {}, 'text', 'Privacy service provided by Withheld for Privacy ehf'], ['adr', { cc: 'IS' }, 'text', ['', '', '', '', '', '', '']], ['email', {}, 'text', 'redacted@example.com']]],
          },
        ],
      },
      's',
    );
    expect(d?.registrant).toEqual({ roles: ['registrant'], email: [], tel: [], country: 'IS', redacted: true });
  });

  it('creates a placeholder registrant when only the redacted array mentions it', () => {
    const d = parseRdapDomain({ ...base, redacted: [{ name: { type: 'Registrant Email' }, method: 'removal' }] }, 's');
    expect(d?.registrant).toEqual({ roles: ['registrant'], email: [], tel: [], redacted: true });
    expect(d?.redactedFields).toEqual(['Registrant Email']);
  });

  it('detects registrant redaction from JSONPath alone', () => {
    const d = parseRdapDomain({ ...base, redacted: [{ name: { description: 'Field 1' }, prePath: "$.entities[?(@.roles[0]=='registrant')].vcardArray" }] }, 's');
    expect(d?.registrant?.redacted).toBe(true);
  });

  it('keeps the first event of each kind and ignores invalid dates and unknown actions', () => {
    const d = parseRdapDomain(
      {
        ...base,
        events: [
          { eventAction: 'registration', eventDate: 'not a date' },
          { eventAction: 'REGISTRATION', eventDate: '2020-01-01T00:00:00Z' },
          { eventAction: 'registration', eventDate: '2021-01-01T00:00:00Z' },
          { eventAction: 'transfer', eventDate: '2022-01-01T00:00:00Z' },
          { eventAction: 'expiration', eventDate: 1700000000 },
          null,
        ],
      },
      's',
    );
    expect(d?.registered).toBe('2020-01-01T00:00:00.000Z');
    expect(d?.expires).toBeUndefined();
  });

  it.each([null, undefined, 0, 'domain', [], [{ ldhName: 'x.com' }], {}, { ldhName: 5 }, { ldhName: '' }, { objectClassName: 'entity', ldhName: 'x.com' }, { errorCode: 404, title: 'Not found' }])(
    'returns null for %j',
    (v) => expect(parseRdapDomain(v, 's')).toBeNull(),
  );

  it('tolerates wrong types everywhere', () => {
    const d = parseRdapDomain(
      {
        ldhName: 'X.COM.',
        unicodeName: 7,
        handle: { a: 1 },
        status: ['active', 5, null, 'active', 'x'.repeat(10_000)],
        events: 'nope',
        entities: [null, 5, { roles: 'registrar' }, { roles: [5, 'REGISTRAR'], vcardArray: 'x', publicIds: [{ type: 'IANA Registrar ID', identifier: 'abc' }, { type: 'iana registrar id', identifier: 9999 }], entities: 'x' }],
        nameservers: [null, { ldhName: 5 }, { ldhName: 'NS1.X.COM.' }, { ldhName: 'ns1.x.com' }],
        redacted: [null, { name: 'x' }, { name: { type: 5 } }],
      },
      's',
    );
    expect(d).toEqual({
      ldhName: 'x.com',
      status: ['active', 'x'.repeat(200)],
      registrar: { ianaId: '9999', abuseEmail: [], abuseTel: [] },
      nameservers: ['ns1.x.com'],
      redactedFields: [],
      server: 's',
    });
  });

  it('takes the registrar URL from an html "about" link', () => {
    const d = parseRdapDomain(
      {
        ...base,
        entities: [
          {
            roles: ['registrar'],
            links: [
              { rel: 'about', href: 'https://rdap.registrar.example/', type: 'application/rdap+json' },
              { rel: 'about', href: 'javascript:alert(1)', type: 'text/html' },
              { rel: 'about', href: 'https://www.registrar.example/', type: 'text/html' },
            ],
          },
        ],
      },
      's',
    );
    expect(d?.registrar?.url).toBe('https://www.registrar.example/');
  });

  it('caps very large arrays', () => {
    const d = parseRdapDomain({ ...base, nameservers: Array.from({ length: 100_000 }, (_, i) => ({ ldhName: `ns${i}.x.com` })), status: Array.from({ length: 100_000 }, (_, i) => `s${i}`) }, 's');
    expect(d?.nameservers.length).toBe(50);
    expect(d?.status.length).toBe(50);
  });

  it('looksRedacted recognises common markers but not ordinary names', () => {
    for (const s of ['REDACTED FOR PRIVACY', 'Data Protected', 'Not Disclosed', 'Domains By Proxy, LLC', 'Statutory Masking Enabled', 'redacted@nominet.uk']) expect(looksRedacted(s)).toBe(true);
    for (const s of ['Google LLC', 'Private Bank AG', 'Acme Widgets']) expect(looksRedacted(s)).toBe(false);
  });
});

describe('isRdapNotFound', () => {
  it('is true for any 404, including Verisign’s empty body and PIR’s error object', () => {
    expect(isRdapNotFound(404, fx('rdap/domain/markwatch-nonexistent-7f3kq9.com.json'))).toBe(true);
    expect(isRdapNotFound(404, fx('rdap/domain/markwatch-nonexistent-7f3kq9.org.json'))).toBe(true);
    expect(isRdapNotFound(404, 'garbage')).toBe(true);
  });
  it('is false for every other status, whatever the body says', () => {
    for (const s of [200, 400, 403, 410, 429, 500, 503]) expect(isRdapNotFound(s, { errorCode: 404 })).toBe(false);
  });
});

describe('parseRdapNetwork on real RIR responses', () => {
  it('ARIN: 8.8.8.8', () => {
    expect(parseRdapNetwork(fx('rdap/ip/8.8.8.8.json'), 'https://rdap.arin.net/registry/')).toEqual({
      handle: 'NET-8-8-8-0-2',
      name: 'GOGL',
      startAddress: '8.8.8.0',
      endAddress: '8.8.8.255',
      cidr: ['8.8.8.0/24'],
      org: 'Google LLC',
      abuseEmail: ['network-abuse@google.com'],
      server: 'https://rdap.arin.net/registry/',
    });
  });

  it('RIPE: 193.0.6.139 (org-kind registrant preferred over the maintainer, country from the network)', () => {
    const n = parseRdapNetwork(fx('rdap/ip/193.0.6.139.json'), 'ripe');
    expect(n).toMatchObject({
      handle: '193.0.0.0 - 193.0.7.255',
      name: 'RIPE-NCC',
      cidr: ['193.0.0.0/21'],
      country: 'NL',
      org: 'Reseaux IP Europeens Network Coordination Centre (RIPE NCC)',
      abuseEmail: ['abuse@ripe.net'],
    });
  });

  it('APNIC: 1.1.1.1', () => {
    expect(parseRdapNetwork(fx('rdap/ip/1.1.1.1.json'), 'apnic')).toMatchObject({
      name: 'APNIC-LABS',
      country: 'AU',
      cidr: ['1.1.1.0/24'],
      org: 'APNIC Research and Development',
      abuseEmail: ['helpdesk@apnic.net'],
    });
  });

  it('ARIN IPv6: Cloudflare, with the abuse role nested under the registrant', () => {
    expect(parseRdapNetwork(fx('rdap/ip/2606_4700_4700__1111.json'), 'arin')).toMatchObject({
      name: 'CLOUDFLARENET',
      cidr: ['2606:4700::/32'],
      org: 'Cloudflare, Inc.',
      abuseEmail: ['abuse@cloudflare.com'],
    });
  });

  it('rejects a domain object', () => {
    expect(parseRdapNetwork(fx('rdap/domain/example.com.json'), 'x')).toBeNull();
  });
});

describe('parseRdapNetwork on hostile input', () => {
  it.each([null, 1, 'x', [], {}, { objectClassName: 'domain', handle: 'x' }, { name: 'only a name' }])('returns null for %j', (v) => expect(parseRdapNetwork(v, 's')).toBeNull());

  it('falls back to the network name for org and validates CIDRs and addresses', () => {
    const n = parseRdapNetwork(
      {
        handle: 'H',
        name: 'SOMENET',
        startAddress: 'not-an-ip',
        country: 'Netherlands',
        cidr0_cidrs: [{ v4prefix: '10.0.0.0', length: 8 }, { v4prefix: '10.0.0.0', length: 33 }, { v6prefix: 'zz::', length: 8 }, { v6prefix: '2001:DB8::', length: 32 }, null, { length: 'x' }],
      },
      's',
    );
    expect(n).toEqual({ handle: 'H', name: 'SOMENET', cidr: ['10.0.0.0/8', '2001:db8::/32'], org: 'SOMENET', abuseEmail: [], server: 's' });
  });

  it('stops recursing at a fixed depth', () => {
    let e: Record<string, unknown> = { roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'deep@example.com']]] };
    for (let i = 0; i < 50; i++) e = { roles: ['x'], entities: [e] };
    const n = parseRdapNetwork({ handle: 'H', entities: [e] }, 's');
    expect(n?.abuseEmail).toEqual([]);
  });

  it('collects abuse emails from several entities, deduplicated', () => {
    const abuse = (mail: string): unknown => ({ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', mail]]] });
    const n = parseRdapNetwork({ handle: 'H', entities: [abuse('A@x.com'), { roles: ['registrant'], entities: [abuse('a@x.com'), abuse('b@x.com')] }] }, 's');
    expect(n?.abuseEmail).toEqual(['a@x.com', 'b@x.com']);
  });
});
