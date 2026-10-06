import { describe, expect, it } from 'vitest';
import { HostLimiter, defaultPolicy, COOLDOWN_BASE_MS, type LimiterDeps } from '../../../src/collect/limiter';

function fakeClock(): LimiterDeps & { t: number; sleeps: number[] } {
  const c = {
    t: 0,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
      return Promise.resolve();
    },
    random: () => 0,
  };
  return c;
}

describe('HostLimiter', () => {
  it('default policies: crt.sh 1 req / 12 s, DoH 8 concurrent, RDAP 2 concurrent', () => {
    expect(defaultPolicy('crt.sh')).toEqual({ concurrency: 1, minGapMs: 12_000 });
    expect(defaultPolicy('dns.google').concurrency).toBe(8);
    expect(defaultPolicy('rdap.verisign.com')).toEqual({ concurrency: 2, minGapMs: 500 });
    expect(defaultPolicy('rdap.arin.net').minGapMs).toBe(250);
  });

  it('enforces the minimum gap between request starts', async () => {
    const clock = fakeClock();
    const lim = new HostLimiter(() => ({ concurrency: 1, minGapMs: 1000 }), clock);
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) await lim.run('h', async () => void starts.push(clock.t));
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('caps concurrency per host', async () => {
    const lim = new HostLimiter(() => ({ concurrency: 2, minGapMs: 0 }), fakeClock());
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = () =>
      lim.run('h', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => releases.push(r));
        active--;
      });
    const all = Promise.all([task(), task(), task(), task()]);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      releases.shift()?.();
    }
    await new Promise((r) => setTimeout(r, 0));
    while (releases.length) releases.shift()?.();
    await all;
    expect(peak).toBe(2);
  });

  it('backs off exponentially after failures and resets on success', async () => {
    const clock = fakeClock();
    const lim = new HostLimiter(() => ({ concurrency: 1, minGapMs: 0 }), clock);
    lim.report('h', false);
    expect(lim.cooldownRemaining('h')).toBe(COOLDOWN_BASE_MS);
    lim.report('h', false);
    expect(lim.cooldownRemaining('h')).toBe(COOLDOWN_BASE_MS * 2);
    await lim.run('h', async () => undefined);
    expect(clock.t).toBe(COOLDOWN_BASE_MS * 2);
    lim.report('h', true);
    lim.report('h', false);
    expect(lim.cooldownRemaining('h')).toBe(COOLDOWN_BASE_MS);
  });

  it('hosts are independent', async () => {
    const clock = fakeClock();
    const lim = new HostLimiter(() => ({ concurrency: 1, minGapMs: 0 }), clock);
    lim.report('a', false);
    await lim.run('b', async () => undefined);
    expect(clock.t).toBe(0);
  });
});
