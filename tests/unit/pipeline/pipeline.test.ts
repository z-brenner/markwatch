import { describe, expect, it } from 'vitest';
import { runDiscovery } from '../../../src/pipeline/discovery';
import { resolveDomains } from '../../../src/pipeline/resolve';
import { buildFacts } from '../../../src/pipeline/facts';
import { newCaseState } from '../../../src/core/casefile';
import { DEFAULT_SETTINGS } from '../../../src/state/store';
import type { CaseState, DomainRecord, LookupResult } from '../../../src/core/types';
import { FakeCollector } from './fakeCollector';

function caseState(over: Partial<CaseState> = {}): CaseState {
  const s = newCaseState({ id: 't', now: '2026-10-05T00:00:00Z', ruleset: { version: 'v', sha256: '0'.repeat(64) }, settings: { ...DEFAULT_SETTINGS, techniques: ['repetition', 'dictionary', 'tld-swap'], dictionary: ['login'], tlds: ['net'] } });
  return { ...s, subject: { marks: ['Acme'], primaryDomain: 'acme.com', owner: 'Acme', rights: [] }, ...over };
}

async function resolve(records: DomainRecord[], c: FakeCollector, retryBlocked = false) {
  const applied = new Map(records.map((r) => [r.domain, { ...r, lookups: [...r.lookups] }]));
  await resolveDomains([...applied.values()], c, {
    useAbusix: true,
    retryBlocked,
    onLookup: (domains, res: LookupResult<unknown>) => {
      for (const d of domains) applied.get(d)!.lookups.push(res);
    },
  });
  return [...applied.values()];
}

describe('discovery', () => {
  it('merges permutations, CT and manual entries; labels inventory and the primary domain', () => {
    const out = runDiscovery({
      state: caseState({ inventory: [{ pattern: 'acme-login.com', kind: 'authorized', party: 'Partner' }] }),
      ctEntries: [{ id: 1, commonName: 'secure.acme-pay.com', names: ['secure.acme-pay.com', '*.acme-pay.com'], issuer: 'x', notBefore: '2026-10-01T00:00:00Z', notAfter: '2026-12-01T00:00:00Z' }],
      manual: ['https://Known-Bad.example.com/path', 'not a domain'],
    });
    const by = new Map(out.records.map((r) => [r.domain, r]));
    expect(by.get('acme.com')!.inventory).toMatchObject({ kind: 'owned', party: 'Primary domain' });
    expect(by.get('acme-login.com')!.inventory).toMatchObject({ kind: 'authorized', party: 'Partner' });
    expect(by.get('acmme.com')!.techniques).toEqual(['repetition']);
    expect(by.get('acme-pay.com')!.sources).toEqual(['ct']);
    expect(by.get('known-bad.example.com')).toMatchObject({ registrable: 'example.com', sources: ['manual'] });
    expect(out.invalidManual).toEqual(['not a domain']);
    expect(out.excludedByInventory).toBe(2);
  });

  it('preserves lookups and classifications of domains already in the case', () => {
    const first = runDiscovery({ state: caseState() });
    const rec = first.records.find((r) => r.domain === 'acmme.com')!;
    const known: DomainRecord = { ...rec, classification: { value: 'cybersquatting', at: '2026-10-05T00:00:00Z' }, lookups: [{ status: 'not_found', kind: 'rdap-domain', query: 'acmme.com', source: 'x', at: '2026-10-05T00:00:00Z', evidence: '404' }] };
    const again = runDiscovery({ state: caseState({ domains: [known] }) });
    const kept = again.records.find((r) => r.domain === 'acmme.com')!;
    expect(kept.classification?.value).toBe('cybersquatting');
    expect(kept.lookups).toHaveLength(1);
    expect(again.added).toBe(first.records.length - 1);
  });
});

describe('resolve', () => {
  const zones = {
    'acmme.com': { ns: ['ns1.sedoparking.com'], a: ['192.0.2.1'], rdap: 'ok' as const },
    'acme-login.com': { ns: ['ns1.x.example'], mx: ['mx.evil.example'], rdap: 'blocked' as const },
    'acme.net': { dnsBlocked: true },
  };
  const records = () => runDiscovery({ state: caseState() }).records;

  it('queries NS for every candidate but enriches only registered ones, and never touches inventory', async () => {
    const c = new FakeCollector(zones);
    const out = await resolve(records(), c);
    expect(c.calls).not.toContain('dns acme.com NS');
    const nsCalls = c.calls.filter((x) => x.endsWith(' NS'));
    expect(nsCalls.length).toBe(out.filter((r) => !r.inventory).length);
    // Unregistered (NXDOMAIN) candidates cost exactly one query.
    expect(c.calls.some((x) => x.startsWith('dns acmee.com ') && !x.endsWith('NS'))).toBe(false);
    for (const t of ['A', 'AAAA', 'MX', 'TXT']) expect(c.calls).toContain(`dns acmme.com ${t}`);
    expect(c.calls).toContain('rdap acmme.com');
    expect(c.calls).toContain('rdap-ip 192.0.2.1');
    expect(c.calls).toContain('abuse 192.0.2.1');
    expect(c.calls.some((x) => /^dns mw-[a-z0-9]{12}\.acmme\.com A$/.test(x))).toBe(true);
  });

  it('facts: verdicts, providers, parking, and blocked lookups stay blocked (never "unregistered")', async () => {
    const out = await resolve(records(), new FakeCollector(zones));
    const f = (d: string) => buildFacts(out.find((r) => r.domain === d)!);
    expect(f('acmme.com')).toMatchObject({ verdict: 'registered', a: ['192.0.2.1'] });
    expect(f('acmme.com').providers.some((p) => p.role === 'parking')).toBe(true);
    expect(f('acmme.com').networks['192.0.2.1']?.org).toBe('Fake Host');
    expect(f('acmme.com').abusix['192.0.2.1']).toEqual(['abuse@abusix.example']);
    expect(f('acme-login.com')).toMatchObject({ verdict: 'registered', mx: ['mx.evil.example'] });
    expect(f('acme-login.com').rdap).toBeUndefined();
    expect(f('acme.net').verdict).toBe('blocked');
    expect(f('acmee.com').verdict).toBe('not_delegated');
  });

  it('resuming skips answered lookups; retryBlocked repeats only blocked ones', async () => {
    const first = await resolve(records(), new FakeCollector(zones));
    const c2 = new FakeCollector(zones);
    await resolve(first, c2);
    expect(c2.calls).toEqual([]);
    const c3 = new FakeCollector(zones);
    await resolve(first, c3, true);
    expect(c3.calls.sort()).toEqual(['dns acme.net NS', 'rdap acme-login.com'].sort());
  });

  it('a domain added later that shares a registrable or IP gets the existing answers without new queries', async () => {
    const first = await resolve(records(), new FakeCollector(zones));
    const late: DomainRecord = { ...first.find((r) => r.domain === 'acmme.com')!, domain: 'login.acmme.com', unicode: 'login.acmme.com', lookups: [] };
    const late2: DomainRecord = { ...late, domain: 'b-acme.com', unicode: 'b-acme.com', registrable: 'b-acme.com' };
    const c = new FakeCollector({ ...zones, 'login.acmme.com': { a: ['192.0.2.1'] }, 'b-acme.com': { ns: ['ns1.x.example'], a: ['192.0.2.1'], rdap: 'ok' } });
    const reused: string[] = [];
    const applied = new Map([...first, late, late2].map((r) => [r.domain, { ...r, lookups: [...r.lookups] }]));
    await resolveDomains([...applied.values()], c, {
      useAbusix: true,
      onLookup: (ds, res) => ds.forEach((d) => applied.get(d)!.lookups.push(res)),
      onReuse: (ds, res) => ds.forEach((d) => (reused.push(`${d} ${res.kind} ${res.query}`), applied.get(d)!.lookups.push(res))),
    });
    // No second NS/RDAP query for acmme.com; its answers are re-applied to the new subdomain.
    expect(c.calls.filter((x) => x === 'dns acmme.com NS' || x === 'rdap acmme.com')).toEqual([]);
    expect(reused).toEqual(expect.arrayContaining(['login.acmme.com dns acmme.com NS', 'login.acmme.com rdap-domain acmme.com']));
    // The shared IP is not re-queried, but b-acme.com gets its network record.
    expect(c.calls).not.toContain('rdap-ip 192.0.2.1');
    expect(buildFacts(applied.get('b-acme.com')!).networks['192.0.2.1']?.org).toBe('Fake Host');
    expect(buildFacts(applied.get('login.acmme.com')!).verdict).toBe('registered');
  });

  it('blocked A lookups are reported as unavailable facts, not as "no website"', async () => {
    const c = new FakeCollector({ 'acmme.com': { ns: ['ns1.x.example'], mx: ['mx.x.example'], rdap: 'ok' } });
    const out = await resolve(records(), c);
    const rec = out.find((r) => r.domain === 'acmme.com')!;
    rec.lookups = rec.lookups.map((l) => (l.kind === 'dns' && l.query === 'acmme.com A' ? { status: 'blocked', kind: 'dns', query: l.query, source: 'x', at: l.at, reason: 'timeout', detail: 't' } : l));
    const f = buildFacts(rec);
    expect(f.checks).toMatchObject({ a: 'unavailable', aaaa: 'answered', mx: 'answered', ns: 'answered' });
  });
});
