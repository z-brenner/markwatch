// One guarded fetch for every lookup. It never lets a failure look like "no
// data": every outcome is either a readable response or a classified block.
//
// How failures are classified (see PLAN.md §2.5):
//  1. Host not in this build's allowlist → 'csp' (checked before any request).
//  2. fetch() rejects:
//     - our timeout fired → 'timeout'; the caller's signal fired → 'cancelled'
//     - a CSP violation was reported for the URL → 'csp'
//     - otherwise a second, opaque `no-cors` request is made. If it succeeds the
//       server is reachable and its answer was unreadable (missing CORS header,
//       typically on 429/5xx/404 error pages) → 'cors_or_error'. If it also
//       fails → 'unreachable'. The browser never exposes the status code of an
//       unreadable response, so we say so instead of guessing.
//  3. Readable 429 → 'rate_limited'. Other statuses are returned to the caller,
//     which decides what an authoritative "not found" looks like.
import { isAllowedUrl } from '../data/allowlist';
import type { BlockReason } from '../core/types';

export type FetchOutcome =
  | { ok: true; status: number; text: string; finalUrl: string; truncated: boolean }
  | { ok: false; reason: BlockReason; detail: string; status?: number };

export interface GuardedFetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Max response characters kept; larger bodies are truncated (and flagged). */
  maxChars?: number;
}

export interface TransportDeps {
  fetch: typeof fetch;
  /** Returns true if a CSP violation was reported for this URL since `since`. */
  cspViolated: (url: string, since: number) => boolean;
  now: () => number;
}

const cspViolations: { uri: string; at: number }[] = [];
let cspListening = false;

/** Starts recording CSP violations (browser only). Idempotent. */
export function watchCspViolations(): void {
  if (cspListening || typeof document === 'undefined') return;
  cspListening = true;
  document.addEventListener('securitypolicyviolation', (e) => {
    cspViolations.push({ uri: e.blockedURI, at: Date.now() });
    if (cspViolations.length > 500) cspViolations.splice(0, cspViolations.length - 500);
  });
}

function defaultCspViolated(url: string, since: number): boolean {
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    /* keep raw */
  }
  return cspViolations.some((v) => v.at >= since && (v.uri === url || v.uri.startsWith(origin)));
}

const defaultDeps = (): TransportDeps => ({ fetch: globalThis.fetch.bind(globalThis), cspViolated: defaultCspViolated, now: Date.now });

const BASE_INIT: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  // Do not leave lookup responses in the browser's HTTP cache on disk.
  cache: 'no-store',
  redirect: 'follow',
};

export const DEFAULT_MAX_CHARS = 2_000_000;

export async function guardedFetch(url: string, opts: GuardedFetchOptions, deps: TransportDeps = defaultDeps()): Promise<FetchOutcome> {
  if (!isAllowedUrl(url)) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep raw */
    }
    return { ok: false, reason: 'csp', detail: `${host} is not in this build's network allowlist, so the browser is not allowed to contact it.` };
  }
  if (opts.signal?.aborted) return { ok: false, reason: 'cancelled', detail: 'Cancelled.' };

  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const started = deps.now();

  try {
    const res = await deps.fetch(url, { ...BASE_INIT, mode: 'cors', headers: opts.headers ?? {}, signal: ctl.signal });
    const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const { text, truncated } = await readLimited(res, max);
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      return { ok: false, reason: 'rate_limited', status: 429, detail: `The server rate-limited this request (HTTP 429${ra ? `, retry after ${ra}` : ''}).` };
    }
    return { ok: true, status: res.status, text, finalUrl: res.url || url, truncated };
  } catch (e) {
    if (opts.signal?.aborted) return { ok: false, reason: 'cancelled', detail: 'Cancelled.' };
    if (timedOut) return { ok: false, reason: 'timeout', detail: `No response within ${Math.round(opts.timeoutMs / 1000)} s.` };
    if (deps.cspViolated(url, started)) {
      return { ok: false, reason: 'csp', detail: 'Blocked by this app’s Content-Security-Policy (for example, a redirect to a host outside the allowlist).' };
    }
    return classifyOpaqueFailure(url, e, deps);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Reads at most `max` characters of a body, cancelling the stream past the
 * limit so a huge response (e.g. a broad crt.sh search) cannot exhaust memory.
 */
async function readLimited(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const all = await res.text();
    return all.length > max ? { text: all.slice(0, max), truncated: true } : { text: all, truncated: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > max) {
      await reader.cancel().catch(() => undefined);
      return { text: text.slice(0, max), truncated: true };
    }
  }
  text += decoder.decode();
  return { text, truncated: false };
}

async function classifyOpaqueFailure(url: string, err: unknown, deps: TransportDeps): Promise<FetchOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    await deps.fetch(url, { ...BASE_INIT, mode: 'no-cors', signal: ctl.signal });
    return {
      ok: false,
      reason: 'cors_or_error',
      detail:
        'Blocked by the browser: the server answered, but its response was not readable here. It may not allow cross-origin lookups, or it rejected or rate-limited the request. Web pages cannot see the status code in this case.',
    };
  } catch {
    return { ok: false, reason: 'unreachable', detail: `Could not reach the server (${err instanceof Error ? err.message : 'network error'}).` };
  } finally {
    clearTimeout(timer);
  }
}
