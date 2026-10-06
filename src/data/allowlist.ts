// The network allowlist. Generated data lives in allowlist.json (see
// scripts/update-bootstrap.mjs); this module is the single source of truth
// for both the CSP connect-src written at build time and runtime checks.
import data from './allowlist.json' with { type: 'json' };

export interface AllowedHost {
  host: string;
  purpose: string;
}

export const ALLOWLIST: readonly AllowedHost[] = data.hosts;
export const ALLOWLIST_BOOTSTRAP_PUBLICATION: string = data.bootstrapPublication;
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(data.hosts.map((h) => h.host));

/** connect-src source list, in the exact order written into the CSP. */
export function connectSrcSources(): string[] {
  return data.hosts.map((h) => `https://${h.host}`);
}

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
