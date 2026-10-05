// A deterministic fake internet for e2e tests. Serves DoH JSON, RDAP and
// crt.sh responses from a small scenario, with realistic CORS behaviour:
// success responses carry `access-control-allow-origin: *`, and the "blocked"
// cases omit it (as real registries do on 429/5xx), so the browser itself
// blocks them and the app's classification path is exercised for real.
import type { Route } from '@playwright/test';
import type { MockHandler } from './guard';

const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
const RR: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');

interface FakeDomain {
  ns?: string[];
  a?: string[];
  aaaa?: string[];
  mx?: string[];
  txt?: string[];
  servfail?: boolean;
  rdap?: 'ok' | 'blocked' | 'notfound';
  registeredDaysAgo?: number;
  registrar?: string;
  status?: string[];
}

export const SCENARIO: Record<string, FakeDomain> = {
  'acme.com': { ns: ['ns1.acme-dns.net', 'ns2.acme-dns.net'], a: ['203.0.113.10'], mx: ['mx.acme.com'], rdap: 'ok', registeredDaysAgo: 4000 },
  // Phishing-style: brand-new, mail-only, risky keyword.
  'acme-login.com': { ns: ['kim.ns.cloudflare.com', 'bob.ns.cloudflare.com'], mx: ['mx1.evilmail.example'], rdap: 'ok', registeredDaysAgo: 5, registrar: 'Example Registrar, LLC' },
  // Lookalike behind a CDN.
  'acrne.com': { ns: ['kim.ns.cloudflare.com', 'bob.ns.cloudflare.com'], a: ['104.21.3.4'], rdap: 'ok', registeredDaysAgo: 40, registrar: 'Example Registrar, LLC' },
  // Parked at Sedo.
  'acmee.com': { ns: ['ns1.sedoparking.com', 'ns2.sedoparking.com'], a: ['64.190.63.111'], rdap: 'ok', registeredDaysAgo: 900, registrar: 'Parking Registrar Inc.' },
  // Registered, but its registry's RDAP answers without CORS headers (like GMO's 429s).
  'acme.shop': { ns: ['ns1.somehost.example'], a: ['198.51.100.7'], rdap: 'blocked' },
  // ccTLD without RDAP in the IANA bootstrap.
  'acme.io': { ns: ['ns1.somehost.example'], a: ['198.51.100.8'] },
  // Only discoverable through certificate transparency.
  'acme-secure-pay.com': { ns: ['ns1.host.example'], a: ['198.51.100.20'], rdap: 'ok', registeredDaysAgo: 3, registrar: 'Example Registrar, LLC' },
  // Licensee domain (authorized list).
  'acme-partner.com': { ns: ['ns1.partner.example'], a: ['198.51.100.9'], rdap: 'ok', registeredDaysAgo: 700, registrar: 'Partner Registrar' },
};

/** crt.sh behaviour: 'ok' returns one certificate naming a new domain; 'blocked' returns a 502 without CORS. */
export interface FakeNetOptions {
  crtsh?: 'ok' | 'blocked';
}

function dohAnswer(name: string, type: string) {
  const n = name.toLowerCase().replace(/\.$/, '');
  const base = { TC: false, RD: true, RA: true, AD: false, CD: false, Question: [{ name: `${n}.`, type: RR[type] }] };
  // Abusix contact DB.
  if (n.endsWith('.abuse-contacts.abusix.zone')) {
    return { ...base, Status: 0, Answer: [{ name: `${n}.`, type: 16, TTL: 300, data: '"abuse@example-host.net"' }] };
  }
  // Wildcard probes: no zone in the scenario is a wildcard.
  const d = SCENARIO[n];
  if (!d) {
    const parent = Object.keys(SCENARIO).find((k) => n.endsWith(`.${k}`));
    if (parent) return { ...base, Status: 3, Authority: [{ name: `${parent}.`, type: 6, TTL: 300, data: `ns1.${parent}. hostmaster.${parent}. 1 7200 3600 1209600 300` }] };
    return { ...base, Status: 3, Authority: [{ name: 'com.', type: 6, TTL: 900, data: 'a.gtld-servers.net. nstld.verisign-grs.com. 1 1800 900 604800 86400' }] };
  }
  if (d.servfail) return { ...base, Status: 2, Comment: 'DNSSEC validation failure' };
  const recs: Record<string, string[] | undefined> = { NS: d.ns?.map((h) => `${h}.`), A: d.a, AAAA: d.aaaa, MX: d.mx?.map((m, i) => `${(i + 1) * 10} ${m}.`), TXT: d.txt?.map((t) => `"${t}"`) };
  const data = recs[type] ?? [];
  return data.length ? { ...base, Status: 0, Answer: data.map((x) => ({ name: `${n}.`, type: RR[type], TTL: 300, data: x })) } : { ...base, Status: 0, Authority: [{ name: `${n}.`, type: 6, TTL: 300, data: `ns1.${n}. h.${n}. 1 2 3 4 5` }] };
}

function rdapDomain(name: string, d: FakeDomain) {
  return {
    objectClassName: 'domain',
    ldhName: name.toUpperCase(),
    handle: `${name.replace(/\W/g, '')}_DOMAIN-TEST`,
    status: d.status ?? ['client transfer prohibited'],
    events: [
      { eventAction: 'registration', eventDate: daysAgo(d.registeredDaysAgo ?? 365) },
      { eventAction: 'expiration', eventDate: daysAgo(-(365 - (d.registeredDaysAgo ?? 0) % 365)) },
    ],
    nameservers: (d.ns ?? []).map((h) => ({ objectClassName: 'nameserver', ldhName: h.toUpperCase() })),
    entities: [
      {
        objectClassName: 'entity',
        roles: ['registrar'],
        publicIds: [{ type: 'IANA Registrar ID', identifier: '9999' }],
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', d.registrar ?? 'Example Registrar, LLC']]],
        entities: [
          {
            objectClassName: 'entity',
            roles: ['abuse'],
            vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Abuse Desk'], ['tel', { type: 'voice' }, 'uri', 'tel:+1.5555550100'], ['email', {}, 'text', 'abuse@registrar.example']]],
          },
        ],
      },
      {
        objectClassName: 'entity',
        roles: ['registrant'],
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'REDACTED FOR PRIVACY']]],
      },
    ],
    redacted: [{ name: { type: 'Registrant Name' }, method: 'removal' }],
  };
}

function rdapIp(ip: string) {
  const cloudflare = ip.startsWith('104.21.');
  return {
    objectClassName: 'ip network',
    handle: cloudflare ? 'NET-104-16-0-0-1' : 'NET-TEST',
    startAddress: cloudflare ? '104.16.0.0' : ip,
    endAddress: cloudflare ? '104.23.255.255' : ip,
    name: cloudflare ? 'CLOUDFLARENET' : 'EXAMPLE-HOST',
    cidr0_cidrs: [{ v4prefix: cloudflare ? '104.16.0.0' : ip, length: cloudflare ? 13 : 32 }],
    entities: [
      { objectClassName: 'entity', roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', cloudflare ? 'Cloudflare, Inc.' : 'Example Host Ltd'], ['kind', {}, 'text', 'org']]] },
      { objectClassName: 'entity', roles: ['abuse'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['email', {}, 'text', cloudflare ? 'abuse@cloudflare.com' : 'abuse@example-host.net']]] },
    ],
  };
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) });

export function fakeNet(opts: FakeNetOptions = {}): MockHandler {
  return async (url, route) => {
    const host = url.hostname;
    if (host === 'cloudflare-dns.com' || host === 'dns.google') {
      const name = url.searchParams.get('name') ?? '';
      const type = url.searchParams.get('type') ?? 'A';
      await json(route, dohAnswer(name, type));
      return true;
    }
    if (host === 'crt.sh') {
      if (opts.crtsh === 'blocked') {
        // 502 with no CORS header: the browser blocks it, exactly like real crt.sh under load.
        await route.fulfill({ status: 502, headers: { 'content-type': 'text/html' }, body: '<html>502 Bad Gateway</html>' });
        return true;
      }
      await json(route, [
        { issuer_ca_id: 1, issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: 'acme-secure-pay.com', name_value: 'acme-secure-pay.com\nwww.acme-secure-pay.com', id: 900001, entry_timestamp: daysAgo(2).replace('Z', ''), not_before: daysAgo(2).replace('Z', ''), not_after: daysAgo(-88).replace('Z', ''), serial_number: '01' },
        { issuer_ca_id: 1, issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: 'shop.acme.com', name_value: 'shop.acme.com', id: 900002, entry_timestamp: daysAgo(20).replace('Z', ''), not_before: daysAgo(20).replace('Z', ''), not_after: daysAgo(-70).replace('Z', ''), serial_number: '02' },
      ]);
      return true;
    }
    if (host === 'data.iana.org') return false;
    // RDAP (domain): any bootstrap host; the path ends in /domain/<name>.
    const dm = /\/domain\/([^/?#]+)$/i.exec(url.pathname);
    if (dm) {
      const name = decodeURIComponent(dm[1]!).toLowerCase();
      const d = SCENARIO[name];
      if (!d || d.rdap === 'notfound') {
        await json(route, { errorCode: 404, title: 'Not Found' }, 404);
        return true;
      }
      if (d.rdap === 'blocked') {
        await route.fulfill({ status: 429, headers: { 'content-type': 'text/plain', 'retry-after': '3600' }, body: 'Too Many Requests' });
        return true;
      }
      await json(route, rdapDomain(name, d));
      return true;
    }
    const im = /\/ip\/([^/?#]+)$/i.exec(url.pathname);
    if (im) {
      await json(route, rdapIp(decodeURIComponent(im[1]!)));
      return true;
    }
    return false;
  };
}
