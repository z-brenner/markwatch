// Checks whether this build's bundled IANA RDAP bootstrap (src/data/rdap-bootstrap.json)
// is out of date. Runs only when the user clicks "Check IANA for updates" on the
// About page: it is one request for a public file, and it tells IANA (and only
// IANA) that someone fetched it. No domain, IP or mark is sent.
//
// The browser cannot update the snapshot itself: the RDAP servers it may contact
// are fixed by the CSP connect-src written at build time. So the result tells the
// user whether to run `npm run update-bootstrap` and rebuild.
import { guardedFetch, type TransportDeps } from './transport';
import { BUNDLED_BOOTSTRAP, parseBootstrapFile, type BootstrapFile } from '../core/rdap/bootstrap';
import { ALLOWED_HOSTS } from '../data/allowlist';

export const IANA_DNS_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
/** The About page warns when the bundled snapshot is older than this. */
export const STALE_AFTER_DAYS = 90;
const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export const BUNDLED_PUBLICATION: string = BUNDLED_BOOTSTRAP.dns.publication;

export interface DriftResult {
  /** current: no TLD changed RDAP server; stale: some did; blocked: the check itself failed. */
  status: 'current' | 'stale' | 'blocked';
  bundledPublication: string;
  livePublication?: string;
  /** Hosts of https RDAP servers in IANA's live file that this build may not contact. */
  newHosts: string[];
  /** TLDs added, removed, or with a different set of https RDAP base URLs. */
  changedTlds: number;
  detail: string;
}

/** Whole days since the bundled snapshot was published (null if the date is unreadable). */
export function bundledAgeDays(now: Date | number, publication: string = BUNDLED_PUBLICATION): number | null {
  const t = Date.parse(publication);
  if (Number.isNaN(t)) return null;
  const n = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, Math.floor((n - t) / DAY_MS));
}

function tldMap(file: BootstrapFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const [keys, urls] of file.services) {
    const sig = [...new Set(urls)].sort().join(' ');
    for (const k of keys) m.set(k, sig);
  }
  return m;
}

/** Pure comparison of two DNS bootstrap files (both already reduced to https URLs). */
export function compareBootstrap(bundled: BootstrapFile, live: BootstrapFile, allowed: ReadonlySet<string> = ALLOWED_HOSTS): { newHosts: string[]; changedTlds: number } {
  const a = tldMap(bundled);
  const b = tldMap(live);
  let changedTlds = 0;
  for (const [tld, sig] of b) if (a.get(tld) !== sig) changedTlds++;
  for (const tld of a.keys()) if (!b.has(tld)) changedTlds++;

  const newHosts = new Set<string>();
  for (const [, urls] of live.services) {
    for (const u of urls) {
      try {
        const url = new URL(u);
        if (url.protocol === 'https:' && !allowed.has(url.hostname)) newHosts.add(url.hostname);
      } catch {
        /* parseBootstrapFile already dropped malformed URLs */
      }
    }
  }
  return { newHosts: [...newHosts].sort(), changedTlds };
}

export async function checkBootstrapDrift(deps?: TransportDeps, opts: { signal?: AbortSignal } = {}): Promise<DriftResult> {
  const bundledPublication = BUNDLED_PUBLICATION;
  const blocked = (detail: string): DriftResult => ({ status: 'blocked', bundledPublication, newHosts: [], changedTlds: 0, detail });

  // No custom headers: a simple GET needs no CORS preflight.
  const res = await guardedFetch(IANA_DNS_BOOTSTRAP_URL, { timeoutMs: TIMEOUT_MS, ...(opts.signal ? { signal: opts.signal } : {}) }, deps);
  if (!res.ok) return blocked(`Could not check IANA: ${res.detail}`);
  if (res.status !== 200) return blocked(`Could not check IANA: data.iana.org answered HTTP ${res.status}.`);
  if (res.truncated) return blocked('Could not check IANA: the response was larger than expected and was cut off.');

  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    return blocked('Could not check IANA: the response was not JSON.');
  }
  const live = parseBootstrapFile(json);
  if (!live || live.services.length === 0) return blocked('Could not check IANA: the response is not an RDAP bootstrap file.');

  const livePublication = live.publication || undefined;
  const { newHosts, changedTlds } = compareBootstrap(BUNDLED_BOOTSTRAP.dns, live);
  const base = { bundledPublication, ...(livePublication ? { livePublication } : {}), newHosts, changedTlds };

  if (newHosts.length > 0) {
    return {
      ...base,
      status: 'stale',
      detail: `IANA now lists ${newHosts.length} RDAP server(s) that this build is not allowed to contact, and ${changedTlds} TLD(s) changed. Lookups for the affected TLDs will be blocked. Run npm run update-bootstrap, review the diff and rebuild.`,
    };
  }
  if (changedTlds > 0) {
    return {
      ...base,
      status: 'stale',
      detail: `${changedTlds} TLD(s) changed RDAP service in IANA's file, but every server is already on this build's allowlist. Run npm run update-bootstrap and rebuild so lookups for those TLDs go to the right server.`,
    };
  }
  return {
    ...base,
    status: 'current',
    detail:
      livePublication && livePublication !== bundledPublication
        ? `IANA's file is newer (published ${livePublication}) but routes every TLD to the same RDAP servers. No update needed.`
        : 'The bundled snapshot matches IANA. No update needed.',
  };
}
