// Hand-built CaseState / DomainRecord fixtures for the drafting tests.
import type { CaseState, DomainFacts, DomainRecord, LookupResult } from '../../../src/core/types';

export const RDAP_AT = '2026-10-05T21:04:11Z';

export function makeState(over: Partial<CaseState> = {}): CaseState {
  return {
    id: 'case-1',
    createdAt: '2026-10-05T20:00:00Z',
    subject: {
      marks: ['acme', 'acmewidgets'],
      primaryDomain: 'acme.com',
      owner: 'Acme Widgets, Inc.',
      rights: [
        { number: '1234567', jurisdiction: 'US', classes: '9, 42', firstUse: '2001-03-01' },
        { number: '7654321', jurisdiction: 'US' },
        { number: '   ', jurisdiction: 'US', note: 'pending: no number yet' },
      ],
    },
    sender: {
      name: 'Pat Example',
      title: 'Senior Counsel',
      organization: 'Acme Widgets, Inc.',
      email: 'pat@acme.example',
      phone: '+1 555 0100',
      address: '1 Example Way\nSpringfield',
    },
    inventory: [],
    settings: {
      cap: 5000,
      techniques: [],
      keyboards: ['qwerty'],
      tlds: [],
      dictionary: [],
      riskyKeywords: [],
      primaryResolver: 'cloudflare',
      useAbusix: true,
      ctEnabled: true,
    },
    domains: [],
    evidence: [
      { sha256: 'a'.repeat(64), name: 'screenshot.png', type: 'image/png', bytes: 10, addedAt: '2026-10-05T21:10:00Z', domains: ['acme-login.com'] },
      { sha256: 'b'.repeat(64), name: 'page.html', type: 'text/html', bytes: 10, addedAt: '2026-10-05T21:11:00Z', domains: [] },
      { sha256: 'c'.repeat(64), name: 'other.png', type: 'image/png', bytes: 10, addedAt: '2026-10-05T21:12:00Z', domains: ['unrelated.example'] },
    ],
    templates: [],
    ruleset: { version: '1', sha256: '0'.repeat(64) },
    audit: [],
    ...over,
  };
}

const ok = (kind: LookupResult<unknown>['kind'], query: string, source: string, at: string): LookupResult<unknown> => ({ kind, query, source, at, status: 'ok', data: {} });

export function makeLookups(): LookupResult<unknown>[] {
  return [
    ok('dns', 'acme-login.com NS', 'cloudflare-dns.com', '2026-10-05T21:00:00Z'),
    ok('dns', 'acme-login.com A', 'cloudflare-dns.com', '2026-10-05T21:00:01Z'),
    ok('dns', 'acme-login.com MX', 'cloudflare-dns.com', '2026-10-05T21:00:02Z'),
    { kind: 'rdap-domain', query: 'acme-login.com', source: 'rdap.verisign.com', at: '2026-10-05T20:00:00Z', status: 'blocked', reason: 'timeout', detail: 'x' },
    ok('rdap-domain', 'acme-login.com', 'rdap.verisign.com', RDAP_AT),
    ok('rdap-ip', '192.0.2.10', 'rdap.arin.net', '2026-10-05T21:05:02Z'),
    ok('abuse', '192.0.2.10', 'cloudflare-dns.com', '2026-10-05T21:05:03Z'),
    { kind: 'ct', query: 'acme', source: 'crt.sh', at: '2026-10-05T21:06:00Z', status: 'blocked', reason: 'timeout', detail: 'crt.sh timed out' },
  ];
}

export function makeFacts(over: Partial<DomainFacts> = {}): DomainFacts {
  return {
    verdict: 'registered',
    verdictReason: 'NS present',
    ns: ['ns1.parking.example', 'ns2.parking.example'],
    a: ['192.0.2.10'],
    aaaa: [],
    mx: ['mx.acme-login.com'],
    txt: [],
    rdap: {
      ldhName: 'acme-login.com',
      status: ['client transfer prohibited'],
      registered: '2026-09-30T12:00:00Z',
      expires: '2027-09-30T12:00:00Z',
      registrar: { name: 'Example Registrar, LLC', ianaId: '9999', abuseEmail: ['abuse@registrar.example'], abuseTel: ['+1.5555550100'] },
      registrant: { roles: ['registrant'], email: [], tel: [], country: 'PA', redacted: true },
      nameservers: ['ns1.parking.example'],
      redactedFields: ['Registrant Name', 'Registrant Email'],
      server: 'https://rdap.verisign.com/com/v1/',
    },
    networks: {
      '192.0.2.10': { org: 'Example Hosting Co', name: 'EXAMPLE-NET', cidr: ['192.0.2.0/24'], abuseEmail: ['abuse@host.example'], server: 'https://rdap.arin.net/registry/' },
    },
    abusix: { '192.0.2.10': ['abuse@host.example', 'abuse@abusix-listed.example'] },
    providers: [{ id: 'sedo', name: 'Sedo', role: 'parking', evidence: 'NS matches parking pattern', trademarkComplaintUrl: 'https://sedo.example/complaint' }],
    ct: [],
    ...over,
  };
}

export function makeDomain(over: Partial<DomainRecord> = {}): DomainRecord {
  return {
    domain: 'acme-login.com',
    unicode: 'acme-login.com',
    registrable: 'acme-login.com',
    techniques: ['dictionary'],
    seeds: ['acme'],
    sources: ['permutation'],
    lookups: makeLookups(),
    facts: makeFacts(),
    score: { total: 55, items: [], rulesetVersion: '1' },
    classification: { value: 'phishing_malware', at: '2026-10-05T21:20:00Z' },
    acks: [],
    dismissedWarnings: [],
    drafts: [],
    evidence: ['b'.repeat(64)],
    ...over,
  };
}
