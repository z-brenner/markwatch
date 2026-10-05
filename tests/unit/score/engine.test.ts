import { describe, expect, it } from 'vitest';
import { scoreDomain, rulesetFingerprint, type ScoreInput } from '../../../src/core/score/engine';
import { RULES, type Rule } from '../../../src/config/scoring.rules';
import { facts } from '../factsFixture';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return { domain: 'acme-x.com', techniques: [], primaryNs: ['ns1.acme.com', 'ns2.acme.com'], ownerName: 'Acme Widgets, Inc.', riskyKeywords: ['login', 'secure', 'pay'], now: NOW, ...over };
}
const ids = (s: ReturnType<typeof scoreDomain>) => s.items.map((i) => i.ruleId);
const rdap = (o: object) => ({ ldhName: 'acme-x.com', status: [], nameservers: [], redactedFields: [], server: 'https://rdap.example/', ...o });

describe('scoring rules', () => {
  it('returns zero with no signals, and every item carries a reason', () => {
    const s = scoreDomain(input({ facts: facts() }));
    expect(s.total).toBe(0);
    expect(s.items).toEqual([]);
    const all = scoreDomain(input({ techniques: ['homoglyph'], domain: 'acme-login.com', facts: facts({ mx: ['mx.x'] }) }));
    for (const i of all.items) expect(i.reason.length).toBeGreaterThan(10);
  });

  it.each([
    [10, 'age-30d', 30],
    [30, 'age-30d', 30],
    [31, 'age-90d', 20],
    [200, 'age-365d', 10],
  ])('age band: %i days → %s (+%i), and only one band counts', (d, id, pts) => {
    const s = scoreDomain(input({ facts: facts({ rdap: rdap({ registered: daysAgo(d) }) }) }));
    expect(ids(s)).toEqual([id]);
    expect(s.total).toBe(pts);
    expect(s.items[0]!.reason).toContain(`${d} days`);
  });

  it('no age points for old, future-dated, or unknown registrations', () => {
    expect(scoreDomain(input({ facts: facts({ rdap: rdap({ registered: daysAgo(400) }) }) })).total).toBe(0);
    expect(scoreDomain(input({ facts: facts({ rdap: rdap({ registered: daysAgo(-5) }) }) })).total).toBe(0);
    expect(scoreDomain(input({ facts: facts({ rdap: rdap({}) }) })).total).toBe(0);
  });

  it('mail-only beats mail-with-web (exclusive group)', () => {
    expect(ids(scoreDomain(input({ facts: facts({ mx: ['mx1.x'] }) })))).toEqual(['mx-no-web']);
    expect(ids(scoreDomain(input({ facts: facts({ mx: ['mx1.x'], aaaa: ['::1'] }) })))).toEqual(['mx-with-web']);
    expect(ids(scoreDomain(input({ facts: facts({ a: ['1.2.3.4'] }) })))).toEqual([]);
  });

  it('parking nameserver names the provider', () => {
    const s = scoreDomain(input({ facts: facts({ providers: [{ id: 'sedo', name: 'Sedo', role: 'parking', evidence: 'ns1.sedoparking.com' }] }) }));
    expect(ids(s)).toEqual(['parking-ns']);
    expect(s.items[0]!.reason).toContain('Sedo');
  });

  it('recent certificate uses the newest notBefore', () => {
    const ct = [
      { id: 1, commonName: 'a', names: [], issuer: 'x', notBefore: daysAgo(200), notAfter: daysAgo(-100) },
      { id: 2, commonName: 'a', names: [], issuer: 'x', notBefore: daysAgo(3), notAfter: daysAgo(-87) },
    ];
    const s = scoreDomain(input({ facts: facts({ ct }) }));
    expect(ids(s)).toEqual(['recent-cert']);
    expect(s.items[0]!.reason).toContain('3 days');
  });

  it('technique-based lookalike points work without any lookups', () => {
    const s = scoreDomain(input({ techniques: ['omission', 'homoglyph', 'bitsquat'] }));
    expect(ids(s)).toEqual(['visual-lookalike']);
    expect(s.items[0]!.reason).toContain('homoglyph, bitsquat');
    expect(scoreDomain(input({ techniques: ['omission'] })).total).toBe(0);
  });

  it('risky keywords are per keyword and capped', () => {
    expect(scoreDomain(input({ domain: 'acme-login.com' })).total).toBe(15);
    expect(scoreDomain(input({ domain: 'acme-securelogin-pay.com' })).total).toBe(30);
  });

  it('wildcard and broken DNS', () => {
    expect(ids(scoreDomain(input({ facts: facts({ wildcard: true }) })))).toEqual(['wildcard']);
    expect(ids(scoreDomain(input({ facts: facts({ verdict: 'registered_broken_dns' }) })))).toEqual(['broken-dns']);
  });

  it('negative signals: same nameservers as primary (order and case insensitive)', () => {
    const s = scoreDomain(input({ facts: facts({ ns: ['NS2.acme.com', 'ns1.acme.com'] }) }));
    expect(ids(s)).toEqual(['ns-match-primary']);
    expect(s.total).toBe(-40);
  });

  it('negative signals: registrant org matches owner, ignoring corporate suffixes; ignored when redacted', () => {
    const reg = (redacted: boolean) => facts({ rdap: rdap({ registrant: { roles: ['registrant'], org: 'ACME WIDGETS LLC', email: [], tel: [], redacted } }) });
    expect(ids(scoreDomain(input({ facts: reg(false) })))).toEqual(['registrant-is-owner']);
    expect(ids(scoreDomain(input({ facts: reg(true) })))).toEqual([]);
  });

  it('on-hold status matches RDAP "client hold" spelling', () => {
    const s = scoreDomain(input({ facts: facts({ rdap: rdap({ status: ['client hold', 'client transfer prohibited'] }) }) }));
    expect(ids(s)).toEqual(['on-hold']);
    expect(s.items[0]!.reason).toContain('client hold');
  });

  it('combines signals into a transparent total', () => {
    const s = scoreDomain(
      input({
        domain: 'acme-login.com',
        techniques: ['homoglyph'],
        facts: facts({ rdap: rdap({ registered: daysAgo(5) }), mx: ['mx.evil'] }),
      }),
    );
    expect(ids(s)).toEqual(['age-30d', 'mx-no-web', 'visual-lookalike', 'risky-keyword']);
    expect(s.total).toBe(30 + 25 + 20 + 15);
    expect(s.total).toBe(s.items.reduce((a, b) => a + b.points, 0));
  });

  it('accepts a custom ruleset and fingerprints rules deterministically', async () => {
    const custom: Rule[] = [{ id: 'x', points: 7, when: { kind: 'wildcardDns' }, reason: 'wild' }];
    expect(scoreDomain(input({ facts: facts({ wildcard: true }) }), custom, 'v-test')).toEqual({ total: 7, items: [{ ruleId: 'x', points: 7, reason: 'wild' }], rulesetVersion: 'v-test' });
    const a = await rulesetFingerprint();
    const b = await rulesetFingerprint([...RULES]);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(b.sha256);
    expect((await rulesetFingerprint(custom)).sha256).not.toBe(a.sha256);
  });

  it('rule ids are unique', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});
