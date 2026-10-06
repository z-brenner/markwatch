import { describe, expect, it } from 'vitest';
import { BrowserCollector } from '../../../src/collect/BrowserCollector';
import { HostLimiter } from '../../../src/collect/limiter';
import type { TransportDeps } from '../../../src/collect/transport';

function collectorAnswering(body: unknown): BrowserCollector {
  const transport: TransportDeps = {
    fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    cspViolated: () => false,
    now: () => 0,
  };
  const limiter = new HostLimiter(() => ({ concurrency: 8, minGapMs: 0 }));
  return new BrowserCollector({ primaryResolver: 'cloudflare', transport, limiter });
}

describe('BrowserCollector.abuseContact', () => {
  it('SERVFAIL/REFUSED is a failed lookup, never "no contact"', async () => {
    for (const Status of [2, 5]) {
      const r = await collectorAnswering({ Status, Answer: [] }).abuseContact('192.0.2.1');
      expect(r.status).toBe('blocked');
    }
  });
  it('NXDOMAIN or an empty answer is an authoritative "no contact"', async () => {
    expect((await collectorAnswering({ Status: 3 }).abuseContact('192.0.2.1')).status).toBe('not_found');
    expect((await collectorAnswering({ Status: 0, Answer: [] }).abuseContact('192.0.2.1')).status).toBe('not_found');
  });
  it('returns the contacts when present', async () => {
    const r = await collectorAnswering({ Status: 0, Answer: [{ name: 'x.', type: 16, TTL: 60, data: '"abuse@example.net"' }] }).abuseContact('192.0.2.1');
    expect(r).toMatchObject({ status: 'ok', data: ['abuse@example.net'] });
  });
});
