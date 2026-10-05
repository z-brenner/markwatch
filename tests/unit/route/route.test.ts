import { describe, expect, it } from 'vitest';
import { routeFor, effectiveTemplates } from '../../../src/core/route/route';
import { ursEligibility, udrpEligibility } from '../../../src/core/route/tld';
import { CLASSIFICATIONS, type DomainFacts } from '../../../src/core/types';
import { facts } from '../factsFixture';

const OUTBOUND = ['registrar-abuse', 'host-abuse', 'dmca-notice', 'demand-letter', 'disclosure-request'];

const rich: DomainFacts = facts({
  a: ['104.21.1.1'],
  rdap: {
    ldhName: 'acme-login.com',
    status: [],
    nameservers: [],
    redactedFields: [],
    server: 'https://rdap.verisign.com/com/v1/',
    registered: '2026-09-30T00:00:00Z',
    registrar: { name: 'Example Registrar, LLC', ianaId: '9999', abuseEmail: ['abuse@registrar.example'], abuseTel: ['+1.5555550100'] },
  },
  networks: { '104.21.1.1': { cidr: ['104.16.0.0/13'], org: 'Cloudflare, Inc.', abuseEmail: ['abuse@cloudflare.com'], server: 'https://rdap.arin.net/registry/' } },
  abusix: { '104.21.1.1': ['abuse@cloudflare.com'] },
  providers: [
    { id: 'cloudflare', name: 'Cloudflare', role: 'cdn', evidence: 'IP network org "Cloudflare, Inc."', abuseUrl: 'https://abuse.cloudflare.com/', hidesOrigin: true },
    { id: 'sedo', name: 'Sedo', role: 'parking', evidence: 'NS ns1.sedoparking.com', trademarkComplaintUrl: 'https://sedo.com/us/about-us/policies/ip-complaint-procedure/' },
  ],
});

describe('routing', () => {
  it('every classification produces a route with a headline, an explanation and at least one step', () => {
    for (const c of CLASSIFICATIONS) {
      const r = routeFor(c, { domain: 'acme-login.com', facts: rich });
      expect(r.classification).toBe(c);
      expect(r.headline.length).toBeGreaterThan(3);
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(0);
    }
  });

  it('phishing → registrar and host abuse reports, contacts carry sources, CDN explained', () => {
    const r = routeFor('phishing_malware', { domain: 'acme-login.com', facts: rich });
    expect(r.allowedTemplates).toEqual(expect.arrayContaining(['registrar-abuse', 'host-abuse']));
    const reg = r.steps.find((s) => s.id === 'registrar-abuse')!.contacts[0]!;
    expect(reg.email).toEqual(['abuse@registrar.example']);
    expect(reg.source).toContain('rdap.verisign.com');
    expect(reg.label).toContain('IANA ID 9999');
    const host = r.steps.find((s) => s.id === 'host-abuse')!;
    expect(host.explanation).toContain('CDN');
    expect(host.contacts.some((c) => c.url === 'https://abuse.cloudflare.com/')).toBe(true);
    expect(host.contacts.some((c) => c.source.includes('Abusix'))).toBe(true);
    expect(r.warnings.some((w) => w.id === 'urgent')).toBe(true);
  });

  it('phishing with no RDAP still routes, with an explicit unknown-contact entry (never silently empty)', () => {
    const r = routeFor('phishing_malware', { domain: 'acme.io', facts: facts() });
    const reg = r.steps.find((s) => s.id === 'registrar-abuse')!.contacts[0]!;
    expect(reg.email).toEqual([]);
    expect(reg.label).toContain('unknown');
    expect(reg.source).toMatch(/RDAP unavailable/);
  });

  it('copied content → DMCA with the non-dismissible copyright-not-trademark banner and a fair-use acknowledgment', () => {
    const r = routeFor('copied_content', { domain: 'acme-login.com', facts: rich });
    expect(r.allowedTemplates).toContain('dmca-notice');
    const banner = r.warnings.find((w) => w.id === 'dmca-copyright-only')!;
    expect(banner.dismissible).toBe(false);
    expect(banner.text).toMatch(/DMCA covers copyright, not trademark/);
    expect(r.warnings.find((w) => w.id === 'dmca-512f')!.text).toContain('512(f)');
    expect(r.requiresAck?.id).toBe('dmca-fair-use-considered');
    expect(effectiveTemplates(r, [])).not.toContain('dmca-notice');
    expect(effectiveTemplates(r, [{ id: 'dmca-fair-use-considered' }])).toContain('dmca-notice');
  });

  it('cybersquatting → demand letter with UDRP, URS (where eligible) and ACPA as escalation', () => {
    const com = routeFor('cybersquatting', { domain: 'acme-login.com', facts: rich });
    expect(com.allowedTemplates).toEqual(expect.arrayContaining(['demand-letter', 'disclosure-request', 'udrp-annex']));
    const esc = Object.fromEntries(com.escalations.map((e) => [e.id, e]));
    expect(esc.udrp!.available).toBe(true);
    expect(esc.urs!.available).toBe(false); // .com has no URS
    expect(esc.acpa!.explanation).toContain('1125(d)');
    expect(routeFor('cybersquatting', { domain: 'acme.shop' }).escalations.find((e) => e.id === 'urs')!.available).toBe(true);
    expect(routeFor('cybersquatting', { domain: 'acme.org' }).escalations.find((e) => e.id === 'urs')!.available).toBe(true);
    const de = routeFor('cybersquatting', { domain: 'acme.de' });
    expect(de.escalations.map((e) => e.id)).toContain('cctld-drp');
  });

  it('reverse domain name hijacking warning when the domain predates the mark rights', () => {
    const r = routeFor('cybersquatting', { domain: 'acme-login.com', facts: rich, earliestRightsDate: '2026-10-01' });
    const w = r.warnings.find((x) => x.id === 'rdnh')!;
    expect(w.level).toBe('danger');
    expect(w.dismissible).toBe(false);
    expect(routeFor('cybersquatting', { domain: 'acme-login.com', facts: rich, earliestRightsDate: '2020-01-01' }).warnings.find((x) => x.id === 'rdnh')).toBeUndefined();
    expect(routeFor('cybersquatting', { domain: 'acme-login.com' }).warnings.find((x) => x.id === 'rdnh-unknown')).toBeDefined();
  });

  it('parked with ads → parking-provider complaint first, with the provider’s complaint URL', () => {
    const r = routeFor('parked_ads', { domain: 'acme-login.com', facts: rich });
    expect(r.steps[0]!.id).toBe('parking-complaint');
    expect(r.steps[0]!.contacts[0]!.url).toContain('sedo.com');
    expect(r.allowedTemplates).toContain('demand-letter');
  });

  it('offered for sale → evidence first, demand letter carries a caution', () => {
    const r = routeFor('for_sale', { domain: 'acme-login.com', facts: rich });
    expect(r.steps[0]!.id).toBe('evidence');
    expect(r.why.join(' ')).toContain('¶4(b)(i)');
    expect(r.warnings.find((w) => w.id === 'for-sale-contact')!.level).toBe('caution');
  });

  it('fair use → no outbound template until counsel consultation is recorded', () => {
    const r = routeFor('fair_use', { domain: 'acme-sucks.com', facts: rich });
    expect(r.requiresAck?.id).toBe('counsel-consulted');
    const locked = effectiveTemplates(r, []);
    for (const t of OUTBOUND) expect(locked).not.toContain(t);
    expect(r.why.join(' ')).toMatch(/Lamparello.*Bosley.*Taubman/);
    expect(effectiveTemplates(r, [{ id: 'counsel-consulted' }])).toEqual(expect.arrayContaining(['demand-letter']));
  });

  it('authorized but noncompliant → ONLY the internal compliance note, never a legal threat', () => {
    const r = routeFor('authorized_noncompliant', { domain: 'partner-acme.com', facts: rich, inventory: { kind: 'authorized', party: 'Partner Co' } });
    expect(r.allowedTemplates).toEqual(['compliance-note']);
    expect(effectiveTemplates(r, [{ id: 'counsel-consulted' }])).toEqual(['compliance-note']);
    expect(r.escalations).toEqual([]);
  });

  it('unrelated → no templates', () => {
    expect(routeFor('unrelated', { domain: 'x.com' }).allowedTemplates).toEqual([]);
  });

  it('owned domains are excluded from enforcement whatever the classification', () => {
    for (const c of CLASSIFICATIONS) {
      const r = routeFor(c, { domain: 'acme.com', facts: rich, inventory: { kind: 'owned' } });
      expect(r.allowedTemplates).toEqual([]);
      expect(r.warnings[0]!.id).toBe('inventory-owned');
    }
  });

  it('authorized-party domains get no outbound templates unless classed as authorized-noncompliant', () => {
    const r = routeFor('cybersquatting', { domain: 'partner-acme.com', inventory: { kind: 'authorized', party: 'Partner Co' } });
    expect(r.allowedTemplates).toEqual([]);
    expect(r.warnings[0]!.text).toContain('Partner Co');
  });
});

describe('TLD policy', () => {
  it.each([
    ['a.com', 'no'],
    ['a.net', 'no'],
    ['a.org', 'yes'],
    ['a.info', 'yes'],
    ['a.biz', 'yes'],
    ['a.shop', 'yes'],
    ['a.de', 'no'],
    ['a.co.uk', 'no'],
    ['a.mobi', 'verify'],
  ])('URS %s → %s', (d, e) => expect(ursEligibility(d).eligible).toBe(e));
  it('UDRP: gTLD yes, ccTLD verify, .gov no', () => {
    expect(udrpEligibility('a.com').eligible).toBe('yes');
    expect(udrpEligibility('a.uk').eligible).toBe('verify');
    expect(udrpEligibility('a.gov').eligible).toBe('no');
  });
});
