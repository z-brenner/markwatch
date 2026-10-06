// The single seam for all network collection. The UI and pipeline consume
// LookupResult values only, so a future local companion process (page capture,
// screenshots, monitoring, a local classifier) can plug in as another Collector
// without UI changes.
import type { CtEntry, DnsAnswer, LookupResult, RdapDomain, RdapNetwork, RRType } from '../core/types';

export type Capability = 'dns' | 'rdap' | 'ct' | 'abuse' | 'capture' | 'screenshot' | 'monitor' | 'classify';

export interface CallOpts {
  signal?: AbortSignal;
}

export interface PageCapture {
  url: string;
  finalUrl: string;
  status: number;
  html?: string;
  screenshotSha256?: string;
}

export interface Collector {
  readonly id: string;
  readonly capabilities: ReadonlySet<Capability>;
  dns(name: string, type: RRType, opts?: CallOpts): Promise<LookupResult<DnsAnswer>>;
  rdapDomain(domain: string, opts?: CallOpts): Promise<LookupResult<RdapDomain>>;
  rdapIp(ip: string, opts?: CallOpts): Promise<LookupResult<RdapNetwork>>;
  /** prefix: names starting with term (reliable); substring: names containing it (best-effort on crt.sh). */
  ctSearch(term: string, opts?: CallOpts & { mode?: 'prefix' | 'substring' }): Promise<LookupResult<CtEntry[]>>;
  abuseContact(ip: string, opts?: CallOpts): Promise<LookupResult<string[]>>;
  /** Out of scope for the browser collector; reserved for a companion process. */
  capturePage?(url: string, opts?: CallOpts): Promise<LookupResult<PageCapture>>;
}
