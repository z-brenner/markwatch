// Per-host request budget: a concurrency cap, a minimum gap between request
// starts, and an exponential cooldown after failures. Many lookup services
// rate-limit by IP and send 429/5xx without CORS headers, which the browser
// cannot read, so we must be conservative up front rather than react to errors.

export interface HostPolicy {
  concurrency: number;
  /** Minimum milliseconds between request starts to this host. */
  minGapMs: number;
}

const DOH: HostPolicy = { concurrency: 8, minGapMs: 0 };
const RDAP: HostPolicy = { concurrency: 2, minGapMs: 500 };
const RIR: HostPolicy = { concurrency: 2, minGapMs: 250 };
const CRTSH: HostPolicy = { concurrency: 1, minGapMs: 12_000 }; // operator limit: 5 requests/min/IP
const IANA: HostPolicy = { concurrency: 1, minGapMs: 0 };
const RIR_HOSTS = new Set(['rdap.arin.net', 'rdap.db.ripe.net', 'rdap.apnic.net', 'rdap.lacnic.net', 'rdap.afrinic.net', 'rdap.registro.br']);

export function defaultPolicy(host: string): HostPolicy {
  if (host === 'cloudflare-dns.com' || host === 'dns.google') return DOH;
  if (host === 'crt.sh') return CRTSH;
  if (host === 'data.iana.org') return IANA;
  if (RIR_HOSTS.has(host)) return RIR;
  return RDAP;
}

export interface LimiterDeps {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
}

const realDeps: LimiterDeps = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }),
  random: Math.random,
};

interface HostState {
  active: number;
  lastStart: number;
  failures: number;
  cooldownUntil: number;
  queue: (() => void)[];
}

export const COOLDOWN_BASE_MS = 2_000;
export const COOLDOWN_MAX_MS = 120_000;

export class HostLimiter {
  private hosts = new Map<string, HostState>();

  constructor(
    private policy: (host: string) => HostPolicy = defaultPolicy,
    private deps: LimiterDeps = realDeps,
  ) {}

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { active: 0, lastStart: -Infinity, failures: 0, cooldownUntil: 0, queue: [] };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Milliseconds until this host may be tried again (0 if ready). */
  cooldownRemaining(host: string): number {
    return Math.max(0, this.state(host).cooldownUntil - this.deps.now());
  }

  /** Record the outcome so later requests back off. Success resets the failure count. */
  report(host: string, ok: boolean): void {
    const s = this.state(host);
    if (ok) {
      s.failures = 0;
      return;
    }
    s.failures++;
    const backoff = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (s.failures - 1));
    const jitter = backoff * 0.2 * this.deps.random();
    s.cooldownUntil = Math.max(s.cooldownUntil, this.deps.now() + backoff + jitter);
  }

  async run<T>(host: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const s = this.state(host);
    const { concurrency } = this.policy(host);
    if (s.active >= concurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => resolve();
        s.queue.push(wake);
        signal?.addEventListener(
          'abort',
          () => {
            const i = s.queue.indexOf(wake);
            if (i >= 0) s.queue.splice(i, 1);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    }
    s.active++;
    try {
      // Wait out cooldown and the minimum gap. Re-check after each sleep because
      // other requests may have started or failed meanwhile.
      for (;;) {
        const now = this.deps.now();
        const wait = Math.max(s.cooldownUntil - now, s.lastStart + this.policy(host).minGapMs - now, 0);
        if (wait <= 0) break;
        await this.deps.sleep(wait, signal);
      }
      s.lastStart = this.deps.now();
      return await fn();
    } finally {
      s.active--;
      s.queue.shift()?.();
    }
  }
}
