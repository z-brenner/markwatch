// Shared fixtures for the case-file tests (not a test file itself).
import { strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { appendAudit } from '../../../src/core/casefile/audit';
import { newCaseState } from '../../../src/core/casefile/newCase';
import type { AuditEntry, CaseSettings, CaseState, DomainRecord, EvidenceFile } from '../../../src/core/types';
import { sha256Hex } from '../../../src/core/util';

export const FIXED_NOW = new Date('2026-10-05T14:30:15.123Z');
export const APP = { version: '0.1.0', buildHash: 'abc1234' };
export const RULESET = { version: 'rules-2026.10', sha256: 'a'.repeat(64) };

export const SETTINGS: CaseSettings = {
  cap: 5000,
  techniques: ['original', 'homoglyph', 'tld-swap'],
  keyboards: ['qwerty'],
  tlds: ['com', 'net', 'co.uk'],
  dictionary: ['login', 'shop'],
  riskyKeywords: ['login', 'secure'],
  primaryResolver: 'cloudflare',
  useAbusix: true,
  ctEnabled: true,
};

export const EVIDENCE_A = strToU8('<html><body>Fake Acme login page</body></html>');
export const EVIDENCE_B = new Uint8Array(Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) & 0xff));

export async function buildFixture(): Promise<{ state: CaseState; evidence: Map<string, Uint8Array> }> {
  const shaA = await sha256Hex(new Uint8Array(EVIDENCE_A));
  const shaB = await sha256Hex(new Uint8Array(EVIDENCE_B));
  const evidenceFiles: EvidenceFile[] = [
    { sha256: shaA, name: 'acme-login (copy).html', type: 'text/html', bytes: EVIDENCE_A.length, addedAt: '2026-10-05T13:00:00.000Z', domains: ['acme-login.com'], note: 'Saved page' },
    { sha256: shaB, name: 'Résumé/../screenshot.png', type: 'image/png', bytes: EVIDENCE_B.length, addedAt: '2026-10-05T13:05:00.000Z', domains: ['acrne.net'] },
  ];

  const d1: DomainRecord = {
    domain: 'acme-login.com',
    unicode: 'acme-login.com',
    registrable: 'acme-login.com',
    techniques: ['original'],
    seeds: ['acme'],
    sources: ['permutation', 'ct'],
    lookups: [
      {
        kind: 'dns',
        status: 'ok',
        query: 'acme-login.com NS',
        source: 'cloudflare-dns.com',
        url: 'https://cloudflare-dns.com/dns-query?name=acme-login.com&type=NS',
        at: '2026-10-05T12:10:00.000Z',
        data: { name: 'acme-login.com', type: 'NS', rcode: 0, ad: false, answers: [{ name: 'acme-login.com', type: 2, ttl: 300, data: 'ns1.parking.example' }], authority: [], resolver: 'cloudflare' },
        raw: '{"Status":0,"Answer":[]}',
      },
      { kind: 'rdap-domain', status: 'blocked', query: 'acme-login.com', source: 'rdap.example', at: '2026-10-05T12:11:00.000Z', reason: 'cors_or_error', detail: 'No CORS header', manualUrl: 'https://rdap.example/domain/acme-login.com' },
      { kind: 'rdap-domain', status: 'manual', query: 'acme-login.com', source: 'manual paste', at: '2026-10-05T12:20:00.000Z', data: { ldhName: 'acme-login.com', status: [], nameservers: [], redactedFields: [], server: 'manual (WHOIS text pasted by user)' }, pastedText: 'Domain Name: ACME-LOGIN.COM\nRegistrar: Example Registrar' },
    ],
    facts: {
      verdict: 'registered',
      verdictReason: 'NS records present',
      ns: ['ns1.parking.example'],
      a: ['192.0.2.10'],
      aaaa: [],
      mx: [],
      txt: ['v=spf1 -all'],
      rdap: {
        ldhName: 'acme-login.com',
        status: ['client transfer prohibited'],
        registered: '2026-09-01T00:00:00Z',
        registrar: { name: 'Example Registrar', ianaId: '9999', abuseEmail: ['abuse@registrar.example'], abuseTel: [] },
        registrant: { roles: ['registrant'], email: [], tel: [], redacted: true },
        nameservers: ['ns1.parking.example'],
        redactedFields: ['Registrant Name'],
        server: 'https://rdap.example/',
      },
      networks: { '192.0.2.10': { name: 'TEST-NET-1', cidr: ['192.0.2.0/24'], abuseEmail: ['abuse@host.example'], server: 'https://rdap.arin.net/registry/' } },
      abusix: { '192.0.2.10': ['abuse@host.example'] },
      providers: [{ id: 'parkco', name: 'ParkCo', role: 'parking', evidence: 'NS ends with .parking.example', trademarkComplaintUrl: 'https://parking.example/tm' }],
      ct: [{ id: 12345, commonName: 'acme-login.com', names: ['acme-login.com', '*.acme-login.com'], issuer: "Let's Encrypt", notBefore: '2026-09-02T00:00:00Z', notAfter: '2026-12-01T00:00:00Z' }],
    },
    score: { total: 72, items: [{ ruleId: 'risky-keyword', points: 30, reason: 'Contains "login"' }], rulesetVersion: RULESET.version },
    classification: { value: 'phishing_malware', at: '2026-10-05T12:30:00.000Z', note: 'Credential form' },
    acks: [{ id: 'ack-1', at: '2026-10-05T12:31:00.000Z', text: 'I reviewed the page' }],
    dismissedWarnings: ['w-cdn'],
    drafts: [
      {
        id: 'draft-1',
        templateId: 'registrar-abuse',
        createdAt: '2026-10-05T12:40:00.000Z',
        body: 'Dear registrar,\n\nacme-login.com hosts a phishing page.',
        subject: 'Phishing report: acme-login.com',
        to: ['abuse@registrar.example'],
        dismissed: [{ field: 'registration_number', reason: 'Unregistered mark' }],
        values: { mark: 'Acme' },
        exports: [{ at: '2026-10-05T12:45:00.000Z', format: 'eml', sha256: 'b'.repeat(64) }],
      },
    ],
    evidence: [shaA],
  };

  const d2: DomainRecord = {
    domain: 'acrne.net',
    unicode: 'acrne.net',
    registrable: 'acrne.net',
    techniques: ['homoglyph', 'tld-swap'],
    seeds: ['acme'],
    sources: ['permutation'],
    lookups: [
      { kind: 'dns', status: 'not_found', query: 'acrne.net NS', source: 'cloudflare-dns.com', at: '2026-10-05T12:12:00.000Z', evidence: 'NXDOMAIN (rcode 3)' },
      { kind: 'ct', status: 'blocked', query: 'acrne', source: 'crt.sh', at: '2026-10-05T12:13:00.000Z', reason: 'timeout', detail: 'No response in 20s' },
    ],
    acks: [],
    dismissedWarnings: [],
    drafts: [],
    evidence: [shaB],
  };

  const base = newCaseState({ id: 'case-1', now: '2026-10-05T12:00:00.000Z', ruleset: RULESET, settings: SETTINGS });
  let audit: AuditEntry[] = [];
  audit = await appendAudit(audit, { actor: 'system', type: 'case.created', payload: { caseId: 'case-1' }, at: '2026-10-05T12:00:00.000Z' });
  audit = await appendAudit(audit, { actor: 'user', type: 'discovery.run', payload: { generated: 120, kept: 2, techniques: ['original', 'homoglyph'] }, at: '2026-10-05T12:05:00.000Z' });
  audit = await appendAudit(audit, { actor: 'system', type: 'lookup', payload: { domain: 'acme-login.com', kind: 'dns', status: 'ok' }, at: '2026-10-05T12:10:00.000Z' });
  audit = await appendAudit(audit, { actor: 'user', type: 'classification.set', payload: { domain: 'acme-login.com', value: 'phishing_malware', note: null }, at: '2026-10-05T12:30:00.000Z' });
  audit = await appendAudit(audit, { actor: 'user', type: 'evidence.added', payload: { sha256: shaA, name: 'acme-login (copy).html', nested: { a: [1, 2, { b: true }] } }, at: '2026-10-05T13:00:00.000Z' });

  const state: CaseState = {
    ...base,
    subject: { marks: ['Acme Widgets', 'ACME'], primaryDomain: 'acme.com', owner: 'Acme Widgets, Inc.', rights: [{ number: '1234567', jurisdiction: 'US', classes: '9, 42' }] },
    sender: { name: 'Jane Doe', title: 'Counsel', organization: 'Acme Widgets, Inc.', email: 'legal@acme.example', phone: '+1 555 0100', address: '1 Main St\nSpringfield' },
    inventory: [
      { pattern: 'acme.com', kind: 'owned' },
      { pattern: '*.acme.net', kind: 'authorized', party: 'Acme Reseller LLC', note: 'Licensed 2025' },
    ],
    domains: [d1, d2],
    evidence: evidenceFiles,
    templates: [{ id: 'custom-1', source: 'counsel-template.txt', importedAt: '2026-10-05T12:01:00.000Z', sha256: 'c'.repeat(64) }],
    audit,
  };
  const evidence = new Map<string, Uint8Array>([
    [shaA, EVIDENCE_A],
    [shaB, EVIDENCE_B],
  ]);
  return { state, evidence };
}

/** Unzip, let the caller edit the entries, zip again. */
export function rezip(bytes: Uint8Array, edit: (files: Unzipped) => void): Uint8Array {
  const files = unzipSync(bytes);
  edit(files);
  return zipSync(files);
}

export function editCaseJson(bytes: Uint8Array, edit: (json: { case: CaseState } & Record<string, unknown>) => void): Uint8Array {
  return rezip(bytes, (files) => {
    const caseJson = files['case.json'];
    if (!caseJson) throw new Error('fixture has no case.json');
    const json = JSON.parse(new TextDecoder().decode(caseJson)) as { case: CaseState } & Record<string, unknown>;
    edit(json);
    files['case.json'] = strToU8(JSON.stringify(json));
  });
}
