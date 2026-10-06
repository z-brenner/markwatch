import { describe, expect, it, vi } from 'vitest';
import { guardedFetch, type TransportDeps } from '../../../src/collect/transport';

const OK_URL = 'https://dns.google/resolve?name=example.com&type=NS';

function deps(impl: (url: string, init: RequestInit) => Promise<Response>, cspViolated = false): TransportDeps & { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  return {
    calls,
    fetch: ((url: string, init: RequestInit) => {
      calls.push(init);
      return impl(url, init);
    }) as unknown as typeof fetch,
    cspViolated: () => cspViolated,
    now: () => 0,
  };
}

describe('guardedFetch', () => {
  it('refuses hosts outside the allowlist without making a request', async () => {
    const d = deps(() => Promise.reject(new Error('should not be called')));
    const r = await guardedFetch('https://evil.example/x', { timeoutMs: 1000 }, d);
    expect(r).toMatchObject({ ok: false, reason: 'csp' });
    expect(d.calls).toHaveLength(0);
    expect(await guardedFetch('http://dns.google/resolve', { timeoutMs: 1000 }, d)).toMatchObject({ ok: false, reason: 'csp' });
  });

  it('returns readable responses with status, never caching or sending credentials', async () => {
    const d = deps(() => Promise.resolve(new Response('{"Status":0}', { status: 200 })));
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000, headers: { accept: 'application/dns-json' } }, d);
    expect(r).toEqual({ ok: true, status: 200, text: '{"Status":0}', finalUrl: OK_URL, truncated: false });
    expect(d.calls[0]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' });
  });

  it('passes readable 404s through for the caller to judge', async () => {
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000 }, deps(() => Promise.resolve(new Response('{}', { status: 404 }))));
    expect(r).toMatchObject({ ok: true, status: 404 });
  });

  it('classifies a readable 429 as rate_limited, including Retry-After', async () => {
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000 }, deps(() => Promise.resolve(new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }))));
    expect(r).toMatchObject({ ok: false, reason: 'rate_limited', status: 429 });
    expect(r.ok ? '' : r.detail).toContain('30');
  });

  it('unreadable response but reachable server → cors_or_error (via an opaque no-cors probe)', async () => {
    const d = deps((_u, init) => (init.mode === 'cors' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(null, { status: 200 }))));
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000 }, d);
    expect(r).toMatchObject({ ok: false, reason: 'cors_or_error' });
    expect(d.calls.map((c) => c.mode)).toEqual(['cors', 'no-cors']);
    expect(r.ok ? '' : r.detail).toMatch(/cannot see the status code/);
  });

  it('both requests fail → unreachable', async () => {
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000 }, deps(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('CSP violation reported for the URL → csp, without a no-cors probe', async () => {
    const d = deps(() => Promise.reject(new TypeError('Failed to fetch')), true);
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000 }, d);
    expect(r).toMatchObject({ ok: false, reason: 'csp' });
    expect(d.calls).toHaveLength(1);
  });

  it('timeout → timeout', async () => {
    vi.useFakeTimers();
    const d = deps((_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const p = guardedFetch(OK_URL, { timeoutMs: 5000 }, d);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
    vi.useRealTimers();
  });

  it('caller cancellation → cancelled', async () => {
    const ctl = new AbortController();
    const d = deps((_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const p = guardedFetch(OK_URL, { timeoutMs: 5000, signal: ctl.signal }, d);
    ctl.abort();
    expect(await p).toMatchObject({ ok: false, reason: 'cancelled' });
    const pre = new AbortController();
    pre.abort();
    expect(await guardedFetch(OK_URL, { timeoutMs: 5000, signal: pre.signal }, d)).toMatchObject({ reason: 'cancelled' });
  });

  it('truncates oversized bodies and flags it', async () => {
    const r = await guardedFetch(OK_URL, { timeoutMs: 1000, maxChars: 5 }, deps(() => Promise.resolve(new Response('0123456789'))));
    expect(r).toMatchObject({ ok: true, text: '01234', truncated: true });
  });
});
