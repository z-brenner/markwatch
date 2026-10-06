import { describe, expect, it } from 'vitest';
import bundled from '../../../src/data/rdap-bootstrap.json' with { type: 'json' };
import {
  BUNDLED_PUBLICATION,
  IANA_DNS_BOOTSTRAP_URL,
  bundledAgeDays,
  checkBootstrapDrift,
  compareBootstrap,
} from '../../../src/collect/bootstrapDrift';
import type { TransportDeps } from '../../../src/collect/transport';
import type { BootstrapFile } from '../../../src/core/rdap/bootstrap';

type Service = [string[], string[]];

/** IANA's own format for the live file, built from the bundled snapshot. */
function liveFile(edit: (services: Service[]) => Service[] = (s) => s, publication = '2026-10-05T12:00:00Z') {
  const services = structuredClone(bundled.dns.services) as Service[];
  return { description: 'RDAP bootstrap file for Domain Name System registrations', publication, services: edit(services), version: '1.0' };
}

function fakeDeps(respond: (url: string) => Promise<Response>): TransportDeps & { urls: string[]; inits: RequestInit[] } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  return {
    urls,
    inits,
    fetch: ((url: string, init: RequestInit) => {
      urls.push(url);
      inits.push(init);
      return respond(url);
    }) as unknown as typeof fetch,
    cspViolated: () => false,
    now: () => 0,
  };
}

const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('bundledAgeDays', () => {
  it('counts whole days since the bundled publication', () => {
    const t = Date.parse(BUNDLED_PUBLICATION);
    expect(bundledAgeDays(t)).toBe(0);
    expect(bundledAgeDays(new Date(t + 90 * 86_400_000 + 1000))).toBe(90);
    expect(bundledAgeDays(t - 86_400_000)).toBe(0);
    expect(bundledAgeDays(0, 'not a date')).toBeNull();
  });
});

describe('compareBootstrap', () => {
  const f = (services: Service[], publication = 'x'): BootstrapFile => ({ publication, services });
  const allowed = new Set(['rdap.a.example', 'rdap.b.example']);

  it('reports nothing when the TLD → server mapping is the same, regardless of order', () => {
    const a = f([[['com', 'net'], ['https://rdap.a.example/']], [['org'], ['https://rdap.b.example/']]]);
    const b = f([[['org'], ['https://rdap.b.example/']], [['net', 'com'], ['https://rdap.a.example/']]]);
    expect(compareBootstrap(a, b, allowed)).toEqual({ newHosts: [], changedTlds: 0 });
  });

  it('counts added, removed and moved TLDs, and lists hosts outside the allowlist', () => {
    const a = f([[['com', 'net'], ['https://rdap.a.example/']], [['gone'], ['https://rdap.b.example/']]]);
    const b = f([
      [['com'], ['https://rdap.a.example/']],
      [['net'], ['https://rdap.b.example/']], // moved to another allowed host
      [['new1', 'new2'], ['https://rdap.z.example/rdap/', 'https://rdap.y.example/']], // new TLDs on new hosts
    ]);
    expect(compareBootstrap(a, b, allowed)).toEqual({ newHosts: ['rdap.y.example', 'rdap.z.example'], changedTlds: 4 });
  });
});

describe('checkBootstrapDrift', () => {
  it('fetches only the public IANA file, without credentials or cache, and reports current', async () => {
    const d = fakeDeps(json(liveFile()));
    const r = await checkBootstrapDrift(d);
    expect(d.urls).toEqual([IANA_DNS_BOOTSTRAP_URL]);
    expect(d.inits[0]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(r).toMatchObject({ status: 'current', bundledPublication: BUNDLED_PUBLICATION, livePublication: '2026-10-05T12:00:00Z', newHosts: [], changedTlds: 0 });
    expect(r.detail).toContain('same RDAP servers');
  });

  it('ignores non-https URLs in the live file, as the bundled snapshot does', async () => {
    const r = await checkBootstrapDrift(fakeDeps(json(liveFile((s) => s.map(([k, u]) => [k, [...u, 'http://plain.example/']] as Service)))));
    expect(r).toMatchObject({ status: 'current', newHosts: [] });
  });

  it('reports new hosts and tells the user to update and rebuild', async () => {
    const live = liveFile((s) => [...s, [['newtld'], ['https://rdap.newregistry.example/']]]);
    const r = await checkBootstrapDrift(fakeDeps(json(live)));
    expect(r).toMatchObject({ status: 'stale', newHosts: ['rdap.newregistry.example'], changedTlds: 1 });
    expect(r.detail).toContain('npm run update-bootstrap');
  });

  it('reports a TLD moved between allowed hosts as stale without new hosts', async () => {
    const live = liveFile((s) => {
      const i = s.findIndex(([, u]) => u.length > 0);
      const other = s.find(([, u], j) => j !== i && u.length > 0 && u[0] !== s[i]![1][0])!;
      return s.map((svc, j) => (j === i ? ([svc[0], other[1]] as Service) : svc));
    });
    const moved = live.services.find(([, u]) => u.length > 0)![0].length;
    const r = await checkBootstrapDrift(fakeDeps(json(live)));
    expect(r).toMatchObject({ status: 'stale', newHosts: [], changedTlds: moved });
  });

  it('never reports "current" when the check could not be made', async () => {
    const failing = fakeDeps(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await checkBootstrapDrift(failing)).toMatchObject({ status: 'blocked', newHosts: [], changedTlds: 0 });
    expect(await checkBootstrapDrift(fakeDeps(json({}, 500)))).toMatchObject({ status: 'blocked', detail: expect.stringContaining('HTTP 500') as string });
    expect(await checkBootstrapDrift(fakeDeps(() => Promise.resolve(new Response('<html>', { status: 200 }))))).toMatchObject({ status: 'blocked', detail: expect.stringContaining('not JSON') as string });
    expect(await checkBootstrapDrift(fakeDeps(json({ services: [] })))).toMatchObject({ status: 'blocked' });
    expect(await checkBootstrapDrift(fakeDeps(json({}, 429)))).toMatchObject({ status: 'blocked', detail: expect.stringContaining('rate-limited') as string });
  });
});
