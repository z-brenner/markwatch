import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePastedDns, parsePastedRdap, parseWhoisDate, parseWhoisText } from '../../../src/core/whois/parse';

const raw = (p: string): string => readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8');

// Layouts follow what the registries' port-43 servers print (abridged).
const GTLD = `   Domain Name: EXAMPLE.COM
   Registry Domain ID: 2336799_DOMAIN_COM-VRSN
   Registrar WHOIS Server: whois.iana.org
   Registrar URL: http://res-dom.iana.org
   Updated Date: 2026-08-14T08:01:43Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2027-08-13T04:00:00Z
   Registrar: RESERVED-Internet Assigned Numbers Authority
   Registrar IANA ID: 376
   Registrar Abuse Contact Email: Abuse@IANA.org
   Registrar Abuse Contact Phone: +1.3103015800
   Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited
   Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited
   Name Server: ELLIOTT.NS.CLOUDFLARE.COM
   Name Server: HERA.NS.CLOUDFLARE.COM
   DNSSEC: signedDelegation
   URL of the ICANN Whois Inaccuracy Complaint Form: https://www.icann.org/wicf/
>>> Last update of whois database: 2026-10-05T23:37:17Z <<<

Registrant Name: REDACTED FOR PRIVACY
Registrant Organization:
Registrant Country: US
Registrant Email: Please query the RDDS service of the Registrar of Record identified in this output for information on how to contact the Registrant
Registrar Registration Expiration Date: 2030-01-01T00:00:00Z
`;

const DENIC = `% Restricted rights.
%
% Terms and Conditions of Use
%
Domain: denic.de
Nserver: ns1.denic.de 77.67.63.106 2001:668:1f:11:0:0:0:106
Nserver: ns2.denic.net
Nserver: ns3.denic.com
Dnskey: 257 3 8 AwEAAb/xrM...
Status: connect
Changed: 2020-12-09T13:12:35+01:00
`;

const NOMINET = `
    Domain name:
        bbc.co.uk

    Data validation:
        Nominet was able to match the registrant's name and address against a 3rd party data source on 21-Aug-2014

    Registrar:
        British Broadcasting Corporation [Tag = BBC]
        URL: https://www.bbc.co.uk

    Relevant dates:
        Registered on: 13-Dec-1994
        Expiry date:  13-Dec-2034
        Last updated:  29-Oct-2025

    Registration status:
        Registered until expiry date.

    Name servers:
        ddns0.bbc.co.uk           148.163.199.1  2607:f740:e04e::1
        ddns0.bbc.com
        dns0.bbc.co.uk            198.51.44.9  2620:4d:4000:6259:7:9:0:1

    WHOIS lookup made at 23:40:00 05-Oct-2026
`;

const EURID = `Domain: eurid.eu
Script: LATIN

Registrant:
        NOT DISCLOSED!
        Visit www.eurid.eu for webbased WHOIS.

Technical:
        Organisation: EURid vzw
        Language: en
        Email: tech@eurid.eu

Registrar:
        Name: EURid vzw
        Website: www.eurid.eu

Name servers:
        nsx.eurid.eu (2001:67c:9c:3937::252)
        ns1.eurid.eu (2001:67c:9c:3937::251)

Keys:
        flags:KSK protocol:3 algorithm:ECDSAP256SHA256 pubKey:abc
`;

describe('parseWhoisText', () => {
  it('reads the ICANN gTLD layout', () => {
    expect(parseWhoisText(GTLD)).toEqual({
      ldhName: 'example.com',
      status: ['clientDeleteProhibited', 'clientTransferProhibited'],
      registered: '1995-08-14T04:00:00.000Z',
      expires: '2027-08-13T04:00:00.000Z',
      lastChanged: '2026-08-14T08:01:43.000Z',
      nameservers: ['elliott.ns.cloudflare.com', 'hera.ns.cloudflare.com'],
      registrar: { name: 'RESERVED-Internet Assigned Numbers Authority', ianaId: '376', url: 'http://res-dom.iana.org', abuseEmail: ['abuse@iana.org'], abuseTel: ['+1.3103015800'] },
      registrarAbuseEmail: ['abuse@iana.org'],
      registrant: { roles: ['registrant'], email: [], tel: [], country: 'US', redacted: true },
    });
  });

  it('tolerates CRLF line endings and varied key casing', () => {
    const crlf = GTLD.replace(/\n/g, '\r\n').replace('Creation Date', 'CREATION DATE').replace('Registry Expiry Date', 'registry expiry date');
    const p = parseWhoisText(crlf);
    expect(p.registered).toBe('1995-08-14T04:00:00.000Z');
    expect(p.expires).toBe('2027-08-13T04:00:00.000Z');
    expect(p.nameservers).toHaveLength(2);
  });

  it('reads DENIC (.de)', () => {
    expect(parseWhoisText(DENIC)).toEqual({
      ldhName: 'denic.de',
      status: ['connect'],
      lastChanged: '2020-12-09T12:12:35.000Z',
      nameservers: ['ns1.denic.de', 'ns2.denic.net', 'ns3.denic.com'],
    });
  });

  it('reads Nominet (.uk) indented blocks', () => {
    expect(parseWhoisText(NOMINET)).toEqual({
      ldhName: 'bbc.co.uk',
      registered: '1994-12-13T00:00:00.000Z',
      expires: '2034-12-13T00:00:00.000Z',
      lastChanged: '2025-10-29T00:00:00.000Z',
      nameservers: ['ddns0.bbc.co.uk', 'ddns0.bbc.com', 'dns0.bbc.co.uk'],
      registrar: { name: 'British Broadcasting Corporation', url: 'https://www.bbc.co.uk', abuseEmail: [], abuseTel: [] },
    });
  });

  it('reads EURid (.eu) blocks and does not take contact data from other blocks', () => {
    expect(parseWhoisText(EURID)).toEqual({
      ldhName: 'eurid.eu',
      nameservers: ['nsx.eurid.eu', 'ns1.eurid.eu'],
      registrar: { name: 'EURid vzw', url: 'https://www.eurid.eu', abuseEmail: [], abuseTel: [] },
      registrant: { roles: ['registrant'], email: [], tel: [], redacted: true },
    });
  });

  it('keeps an unredacted registrant', () => {
    const p = parseWhoisText('Domain Name: acme-login.com\nRegistrant Name: John Doe\nRegistrant Organization: Evil Corp\nRegistrant Country: gb\nRegistrant Email: JD@evil.example\nRegistrant Phone: +44.2000000000\n');
    expect(p.registrant).toEqual({ roles: ['registrant'], name: 'John Doe', org: 'Evil Corp', country: 'GB', email: ['jd@evil.example'], tel: ['+44.2000000000'], redacted: false });
  });

  it('first value wins (registry expiry before registrar expiration)', () => {
    expect(parseWhoisText(GTLD).expires).toBe('2027-08-13T04:00:00.000Z');
  });

  it.each(['', '   \n\n', 'No match for "ACME-NOPE.COM".', '%%%%', 'x'.repeat(5_000_000)])('returns {} when nothing is recognised (%#)', (t) => {
    expect(parseWhoisText(t)).toEqual({});
  });

  it('never throws on hostile input', () => {
    expect(parseWhoisText(null as unknown as string)).toEqual({});
    expect(parseWhoisText('Domain Name:\n\u0000\u202e\nName Server: ' + 'a'.repeat(10_000) + '\nCreation Date: soon\nRegistrar IANA ID: abc\nDomain Status: https://icann.org/epp#x\nRegistrar URL: javascript:alert(1)')).toEqual({});
  });
});

describe('parseWhoisDate', () => {
  it.each([
    ['2026-08-14T08:01:43Z', '2026-08-14T08:01:43.000Z'],
    ['2001-01-13 00:12:14', '2001-01-13T00:12:14.000Z'],
    ['2001-01-13 00:12:14 UTC', '2001-01-13T00:12:14.000Z'],
    ['2024.01.02', '2024-01-02T00:00:00.000Z'],
    ['2024/1/2 10:11:12', '2024-01-02T10:11:12.000Z'],
    ['13-Dec-1994', '1994-12-13T00:00:00.000Z'],
    ['13-December-1994', '1994-12-13T00:00:00.000Z'],
    ['02.01.2024', '2024-01-02T00:00:00.000Z'],
  ])('%s → %s', (input, want) => expect(parseWhoisDate(input)).toBe(want));
  it.each(['', 'never', '31-Feb-2024', '13-Foo-1994', '2024.13.01'])('rejects %j', (v) => expect(parseWhoisDate(v)).toBeUndefined());
});

describe('parsePastedRdap', () => {
  it('parses a pasted real response and labels the server "manual"', () => {
    const d = parsePastedRdap(raw('rdap/domain/wikipedia.org.json'));
    expect(d?.ldhName).toBe('wikipedia.org');
    expect(d?.server).toBe('manual');
    expect(d?.registrar?.abuseEmail).toEqual(['abusecomplaints@markmonitor.com']);
  });
  it.each(['', 'not json', '{"ldhName":', '[]', 'null', '{"errorCode":404}', raw('rdap/ip/8.8.8.8.json')])('returns null for %#', (t) => expect(parsePastedRdap(t)).toBeNull());
});

const DIG_NS = `; <<>> DiG 9.18.28 <<>> example.com NS
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr rd ra ad; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 1

;; QUESTION SECTION:
;example.com.			IN	NS

;; ANSWER SECTION:
example.com.		86400	IN	NS	HERA.NS.CLOUDFLARE.COM.
example.com.		86400	IN	NS	elliott.ns.cloudflare.com.

;; ADDITIONAL SECTION:
elliott.ns.cloudflare.com. 300 IN A 108.162.193.1

;; Query time: 20 msec
`;

const DIG_NX = `;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 1
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1

;; QUESTION SECTION:
;markwatch-nonexistent-7f3kq9.com. IN	NS

;; AUTHORITY SECTION:
com.			900	IN	SOA	a.gtld-servers.net. nstld.verisign-grs.com. 1791243449 1800 900 604800 900
`;

describe('parsePastedDns', () => {
  it('parses full dig output (status, AD flag, question, sections; additional ignored)', () => {
    expect(parsePastedDns(DIG_NS)).toEqual({
      name: 'example.com',
      type: 'NS',
      rcode: 0,
      ad: true,
      answers: [
        { name: 'example.com', type: 2, ttl: 86400, data: 'hera.ns.cloudflare.com' },
        { name: 'example.com', type: 2, ttl: 86400, data: 'elliott.ns.cloudflare.com' },
      ],
      authority: [],
      resolver: 'manual',
    });
  });

  it('parses NXDOMAIN with the SOA in authority', () => {
    const a = parsePastedDns(DIG_NX);
    expect(a).toMatchObject({ name: 'markwatch-nonexistent-7f3kq9.com', type: 'NS', rcode: 3, ad: false, answers: [] });
    expect(a?.authority[0]).toMatchObject({ name: 'com', type: 6 });
  });

  it('parses bare record lines and quoted TXT', () => {
    const a = parsePastedDns('example.com. 300 IN TXT "v=spf1" " -all"\nexample.com. 300 IN TXT "x"', { name: 'example.com', type: 'TXT' });
    expect(a?.answers.map((r) => r.data)).toEqual(['v=spf1 -all', 'x']);
    expect(a?.rcode).toBe(0);
  });

  it('accepts lines without TTL or class, and generic TYPEnnn', () => {
    const a = parsePastedDns('x.com IN MX 10 Mail.X.com.\nx.com TYPE65 1 . alpn=h2');
    expect(a?.type).toBe('MX');
    expect(a?.answers).toEqual([
      { name: 'x.com', type: 15, ttl: 0, data: '10 mail.x.com' },
      { name: 'x.com', type: 65, ttl: 0, data: '1 . alpn=h2' },
    ]);
  });

  it('parses dig +short output when the query is known, validating each line', () => {
    expect(parsePastedDns('93.184.215.14\n96.7.128.198\n', { name: 'example.com', type: 'A' })?.answers.map((r) => r.data)).toEqual(['93.184.215.14', '96.7.128.198']);
    expect(parsePastedDns('hello world', { name: 'example.com', type: 'A' })).toBeNull();
    expect(parsePastedDns('93.184.215.14')).toBeNull();
  });

  it('parses a pasted DoH JSON body (real fixture)', () => {
    const a = parsePastedDns(raw('doh/google/example.com_NS.json'));
    expect(a).toMatchObject({ name: 'example.com', type: 'NS', rcode: 0, resolver: 'manual' });
    expect(a?.answers).toHaveLength(2);
  });

  it.each(['', 'random words here', ';; only a comment', '{ not json', '{"Status":0}', '{"Question":[{"name":"x.com","type":999}],"Status":0}'])('returns null for %j', (t) => {
    expect(parsePastedDns(t)).toBeNull();
  });

  it('never throws on hostile input', () => {
    expect(parsePastedDns(null as unknown as string)).toBeNull();
    const big = Array.from({ length: 30_000 }, (_, i) => `h${i}.x.com. 1 IN A 1.2.3.4`).join('\n');
    expect(parsePastedDns(big)?.answers.length).toBe(500);
  });
});
