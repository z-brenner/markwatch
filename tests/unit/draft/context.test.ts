import { describe, expect, it } from 'vitest';
import { addBusinessDays, buildDraftContext, CONTEXT_FIELDS, isSourcedValue, ursEligibility, type DraftContext } from '../../../src/core/draft/context';
import { ursEligibility as ursEligibilityForTld } from '../../../src/core/route/tld';
import { lookupPath } from '../../../src/core/draft/merge';
import { makeDomain, makeFacts, makeState, RDAP_AT } from './fixtures';

const NOW = new Date('2026-10-05T22:00:00Z'); // a Monday
const get = (ctx: DraftContext, path: string): unknown => lookupPath(ctx, path);

/** Flattens the context into leaf paths (stopping at Sourced values and arrays). */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node) || isSourcedValue(node)) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe('buildDraftContext', () => {
  const ctx = buildDraftContext(makeState(), makeDomain(), { now: NOW });

  it('only produces documented paths', () => {
    const documented = new Set(CONTEXT_FIELDS.map((f) => f.path));
    for (const p of leafPaths(ctx)) expect(documented, p).toContain(p);
    expect(new Set(CONTEXT_FIELDS.map((f) => f.path)).size).toBe(CONTEXT_FIELDS.length);
  });

  it('fills case and domain basics', () => {
    expect(get(ctx, 'today')).toBe('2026-10-05');
    expect(get(ctx, 'domain')).toBe('acme-login.com');
    expect(get(ctx, 'registrable')).toBe('acme-login.com');
    expect(get(ctx, 'classification.label')).toBe('Phishing or malware');
    expect(get(ctx, 'techniques')).toEqual(['dictionary']);
    expect(get(ctx, 'mark.names')).toEqual(['acme', 'acmewidgets']);
    expect(get(ctx, 'mark.primary')).toBe('acme');
    expect(get(ctx, 'mark.owner')).toBe('Acme Widgets, Inc.');
    expect(get(ctx, 'sender.address')).toBe('1 Example Way\nSpringfield');
    expect(get(ctx, 'score.total')).toBe(55);
  });

  it('formats mark rights exactly as entered and skips entries without a number', () => {
    expect(get(ctx, 'mark.rights')).toEqual(['Reg. No. 1234567 (US), classes 9, 42, first use 2001-03-01', 'Reg. No. 7654321 (US)']);
    const none = buildDraftContext(makeState({ subject: { marks: ['acme'], primaryDomain: 'acme.com', owner: 'A', rights: [] } }), makeDomain(), { now: NOW });
    expect(get(none, 'mark.rights')).toBeUndefined();
  });

  it('sources RDAP facts from the latest successful RDAP lookup ("<source>, <at>")', () => {
    const src = `RDAP rdap.verisign.com, ${RDAP_AT}`;
    expect(get(ctx, 'registrar.name')).toEqual({ value: 'Example Registrar, LLC', source: src });
    expect(get(ctx, 'registrar.ianaId')).toEqual({ value: '9999', source: src });
    expect(get(ctx, 'registrar.abuseEmail')).toEqual({ value: ['abuse@registrar.example'], source: src });
    expect(get(ctx, 'registration.created')).toEqual({ value: '2026-09-30T12:00:00Z', source: src });
    expect(get(ctx, 'registry.server')).toEqual({ value: 'https://rdap.verisign.com/com/v1/', source: src });
  });

  it('handles a redacted registrant: no name/org/email, redacted = yes', () => {
    expect(get(ctx, 'registrant.name')).toBeUndefined();
    expect(get(ctx, 'registrant.org')).toBeUndefined();
    expect(get(ctx, 'registrant.email')).toBeUndefined();
    expect(get(ctx, 'registrant.country')).toMatchObject({ value: 'PA' });
    expect(get(ctx, 'registrant.redacted')).toMatchObject({ value: 'yes' });
  });

  it('exposes an unredacted registrant', () => {
    const facts = makeFacts();
    facts.rdap!.registrant = { roles: ['registrant'], name: 'Jo Squatter', org: 'Squat LLC', email: ['jo@squat.example'], tel: [], redacted: false };
    facts.rdap!.redactedFields = [];
    const c = buildDraftContext(makeState(), makeDomain({ facts }), { now: NOW });
    expect(get(c, 'registrant.name')).toMatchObject({ value: 'Jo Squatter' });
    expect(get(c, 'registrant.email')).toMatchObject({ value: ['jo@squat.example'] });
    expect(get(c, 'registrant.redacted')).toMatchObject({ value: 'no' });
  });

  it('without RDAP, registrar/registration/registrant fields are absent, not invented', () => {
    const facts = makeFacts();
    delete facts.rdap;
    const c = buildDraftContext(makeState(), makeDomain({ facts, lookups: makeDomain().lookups.filter((l) => l.kind !== 'rdap-domain') }), { now: NOW });
    for (const p of ['registrar.name', 'registrar.ianaId', 'registrar.abuseEmail', 'registry.server', 'registration.created', 'registrant.redacted']) {
      expect(get(c, p), p).toBeUndefined();
    }
    expect(get(c, 'dns.ns')).toBeDefined();
  });

  it('sources DNS facts from the matching DNS lookup', () => {
    expect(get(ctx, 'dns.ns')).toEqual({ value: ['ns1.parking.example', 'ns2.parking.example'], source: 'DNS cloudflare-dns.com, 2026-10-05T21:00:00Z' });
    expect(get(ctx, 'dns.mx')).toEqual({ value: ['mx.acme-login.com'], source: 'DNS cloudflare-dns.com, 2026-10-05T21:00:02Z' });
    expect(get(ctx, 'dns.aaaa')).toBeUndefined();
    expect(get(ctx, 'host.ips')).toEqual([{ value: '192.0.2.10', source: 'DNS cloudflare-dns.com, 2026-10-05T21:00:01Z' }]);
  });

  it('unions RDAP and Abusix abuse contacts, crediting the Abusix Contact DB', () => {
    expect(get(ctx, 'host.abuseEmail')).toEqual([
      { value: 'abuse@host.example', source: 'RDAP rdap.arin.net, 2026-10-05T21:05:02Z; Abusix Contact DB (cloudflare-dns.com), 2026-10-05T21:05:03Z' },
      { value: 'abuse@abusix-listed.example', source: 'Abusix Contact DB (cloudflare-dns.com), 2026-10-05T21:05:03Z' },
    ]);
    expect(get(ctx, 'host.networkOrg')).toEqual([{ value: 'Example Hosting Co', source: 'RDAP rdap.arin.net, 2026-10-05T21:05:02Z' }]);
    expect(get(ctx, 'host.networkName')).toEqual([{ value: 'EXAMPLE-NET', source: 'RDAP rdap.arin.net, 2026-10-05T21:05:02Z' }]);
  });

  it('leaves Abusix contacts out when the Abusix setting is off', () => {
    const state = makeState();
    state.settings.useAbusix = false;
    const c = buildDraftContext(state, makeDomain(), { now: NOW });
    expect(get(c, 'host.abuseEmail')).toEqual([{ value: 'abuse@host.example', source: 'RDAP rdap.arin.net, 2026-10-05T21:05:02Z' }]);
  });

  it('labels manually pasted lookups as such', () => {
    const domain = makeDomain();
    domain.lookups = domain.lookups.map((l) => (l.kind === 'rdap-domain' && l.status === 'ok' ? { kind: l.kind, query: l.query, source: l.source, at: l.at, status: 'manual' as const, data: {}, pastedText: '{}' } : l));
    const c = buildDraftContext(makeState(), domain, { now: NOW });
    expect(get(c, 'registrar.name')).toEqual({ value: 'Example Registrar, LLC', source: `RDAP rdap.verisign.com (pasted manually by the user), ${RDAP_AT}` });
  });

  it('a blocked CT lookup yields no ct.count (never "0 certificates")', () => {
    expect(get(ctx, 'ct.count')).toBeUndefined();
    const domain = makeDomain();
    domain.lookups.push({ kind: 'ct', query: 'acme', source: 'crt.sh', at: '2026-10-05T21:07:00Z', status: 'ok', data: [] });
    const c = buildDraftContext(makeState(), domain, { now: NOW });
    expect(get(c, 'ct.count')).toEqual({ value: 0, source: 'CT crt.sh, 2026-10-05T21:07:00Z' });
  });

  it('reports the latest CT certificate', () => {
    const facts = makeFacts({
      ct: [
        { id: 1, commonName: 'a', names: [], issuer: 'x', notBefore: '2026-09-01T00:00:00Z', notAfter: '2026-12-01T00:00:00Z' },
        { id: 2, commonName: 'a', names: [], issuer: 'x', notBefore: '2026-10-01T00:00:00Z', notAfter: '2026-12-30T00:00:00Z' },
      ],
    });
    const c = buildDraftContext(makeState(), makeDomain({ facts }), { now: NOW });
    expect(get(c, 'ct.latestNotBefore')).toBe('2026-10-01T00:00:00Z'); // the only CT lookup was blocked, so no source
    expect(get(c, 'ct.count')).toBe(2);
  });

  it('lists only evidence linked to the domain (by record or by evidence.domains)', () => {
    expect(get(ctx, 'evidence.list')).toEqual([`screenshot.png — SHA-256 ${'a'.repeat(64)}`, `page.html — SHA-256 ${'b'.repeat(64)}`]);
  });

  it('infers parking and CDN from providers, with an inference source', () => {
    expect(get(ctx, 'parking.name')).toEqual({ value: 'Sedo', source: 'Markwatch provider inference (NS matches parking pattern)' });
    expect(get(ctx, 'parking.complaintUrl')).toMatchObject({ value: 'https://sedo.example/complaint' });
    expect(get(ctx, 'cdn.name')).toBeUndefined();
    const facts = makeFacts({ providers: [{ id: 'cf', name: 'Cloudflare', role: 'cdn', evidence: 'IP in Cloudflare range', abuseUrl: 'https://abuse.cloudflare.com', hidesOrigin: true }] });
    const c = buildDraftContext(makeState(), makeDomain({ facts }), { now: NOW });
    expect(get(c, 'cdn.name')).toMatchObject({ value: 'Cloudflare' });
    expect(get(c, 'cdn.abuseUrl')).toMatchObject({ value: 'https://abuse.cloudflare.com' });
  });

  it('collapses control characters in untrusted lookup data', () => {
    const facts = makeFacts();
    facts.rdap!.registrar!.name = 'Evil\r\nBcc: x@y';
    const c = buildDraftContext(makeState(), makeDomain({ facts }), { now: NOW });
    expect(get(c, 'registrar.name')).toMatchObject({ value: 'Evil Bcc: x@y' });
  });

  it('falls back to the route classification and exposes inventory party', () => {
    const domain = makeDomain({ inventory: { kind: 'authorized', pattern: 'acme-login.com', party: 'Partner Co' } });
    delete domain.classification;
    const c = buildDraftContext(makeState(), domain, {
      now: NOW,
      route: { classification: 'authorized_noncompliant', headline: '', why: [], steps: [], escalations: [], warnings: [], allowedTemplates: [] },
    });
    expect(get(c, 'classification.label')).toBe('Authorized but noncompliant');
    expect(get(c, 'inventory.party')).toBe('Partner Co');
  });

  it('computes URS eligibility from the TLD', () => {
    const forDomain = (d: string): unknown => get(buildDraftContext(makeState(), makeDomain({ domain: d, registrable: d, unicode: d }), { now: NOW }), 'urs.eligible');
    expect(forDomain('acme-login.com')).toMatch(/^no — The \.com registry agreement/);
    expect(forDomain('acme-login.org')).toMatch(/^yes — \.org/);
    expect(forDomain('acme-login.shop')).toMatch(/^yes — \.shop appears to be a post-2012 gTLD/);
    expect(forDomain('acme-login.de')).toMatch(/^verify — \.de is a country-code TLD/);
    expect(forDomain('acme-login.mobi')).toMatch(/^verify — \.mobi is a legacy gTLD/);
  });

  it('computes follow-up dates per Registration Data Policy §10.5', () => {
    expect(get(ctx, 'followUp.ack')).toBe('2026-10-07'); // Mon + 2 business days
    expect(get(ctx, 'followUp.response')).toBe('2026-11-06'); // ack + 30 calendar days
    const fri = buildDraftContext(makeState(), makeDomain(), { now: new Date('2026-10-09T23:59:00Z') });
    expect(get(fri, 'today')).toBe('2026-10-09');
    expect(get(fri, 'followUp.ack')).toBe('2026-10-13'); // Fri → Tue, across the weekend
    expect(get(fri, 'followUp.response')).toBe('2026-11-12');
  });
});

describe('ursEligibility (draft text, derived from route/tld.ts)', () => {
  it.each([
    ['example.com', /^no — The \.com registry agreement does not include URS/],
    ['example.net', /^no — The \.net registry agreement/],
    ['example.edu', /^no — \.edu is a restricted TLD/],
    ['example.org', /^yes — \.org/],
    ['example.info', /^yes — \.info/],
    ['example.biz', /^yes — \.biz/],
    ['example.shop', /^yes — \.shop/],
    ['example.mobi', /^verify — \.mobi is a legacy gTLD/],
    ['example.pro', /^verify — \.pro/],
    ['example.asia', /^verify — \.asia/],
    ['example.de', /^verify — \.de is a country-code TLD.*a few have adopted it voluntarily/],
    ['example.co.uk', /^verify — \.uk is a country-code TLD/],
    ['example.xn--p1ai', /^verify — \.xn--p1ai is an internationalized \(IDN\) TLD.*IDN country-code TLD/],
    ['EXAMPLE.ORG.', /^yes — \.org/],
  ])('%s', (d, re) => {
    expect(ursEligibility(d)).toMatch(re);
  });

  it('agrees with the route layer for every TLD class (single source of truth)', () => {
    for (const d of ['a.com', 'a.org', 'a.shop', 'a.mobi', 'a.de', 'a.xn--p1ai', 'a.xn--3e0b707e', 'a.gov']) {
      const r = ursEligibilityForTld(d);
      expect(ursEligibility(d), d).toBe(`${r.eligible} — ${r.note}`);
    }
  });
});

describe('addBusinessDays', () => {
  it.each([
    ['2026-10-05', '2026-10-07'], // Mon → Wed
    ['2026-10-08', '2026-10-12'], // Thu → Mon
    ['2026-10-09', '2026-10-13'], // Fri → Tue
    ['2026-10-10', '2026-10-13'], // Sat → Tue
    ['2026-10-11', '2026-10-13'], // Sun → Tue
  ])('%s + 2 = %s', (from, to) => {
    expect(addBusinessDays(new Date(`${from}T12:00:00Z`), 2).toISOString().slice(0, 10)).toBe(to);
  });
});
