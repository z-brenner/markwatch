// Collector that runs every lookup from the browser over fetch(): DNS over
// HTTPS (Cloudflare, Google fallback), RDAP routed by the bundled IANA
// bootstrap, crt.sh, and Abusix over DoH. All requests go through
// guardedFetch (allowlist + failure classification) and HostLimiter (per-host
// budgets), and every outcome is a LookupResult — never a silent empty.
import type { Capability, CallOpts, Collector } from './Collector';
import { guardedFetch, type TransportDeps } from './transport';
import { HostLimiter } from './limiter';
import { dohUrl, manualDnsUrl, parseDohJson } from '../core/dns/doh';
import { abusixQueryName, parseAbusixTxt } from '../core/dns/abusix';
import { rdapDomainTarget, rdapIpTarget, icannLookupUrl } from '../core/rdap/bootstrap';
import { parseRdapDomain, parseRdapNetwork } from '../core/rdap/parse';
import { crtshUrl, manualCrtshUrl, parseCrtsh } from '../core/ct/crtsh';
import { nowUtc } from '../core/util';
import type { BlockReason, CtEntry, DnsAnswer, LookupKind, LookupResult, RdapDomain, RdapNetwork, RRType } from '../core/types';

export interface BrowserCollectorOptions {
  primaryResolver: 'cloudflare' | 'google';
  limiter?: HostLimiter;
  transport?: TransportDeps;
}

const RAW_MAX = 100_000;
const DNS_TIMEOUT = 10_000;
const RDAP_TIMEOUT = 20_000;
const CT_TIMEOUT = 60_000;
const RDAP_ACCEPT = { accept: 'application/rdap+json, application/json;q=0.9' };

const hostOf = (url: string) => new URL(url).hostname;

function blocked<T>(kind: LookupKind, query: string, source: string, reason: BlockReason, detail: string, url?: string, manualUrl?: string): LookupResult<T> {
  return { status: 'blocked', kind, query, source, reason, detail, at: nowUtc(), ...(url ? { url } : {}), ...(manualUrl ? { manualUrl } : {}) };
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class BrowserCollector implements Collector {
  readonly id = 'browser';
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(['dns', 'rdap', 'ct', 'abuse']);
  private limiter: HostLimiter;

  constructor(private opts: BrowserCollectorOptions) {
    this.limiter = opts.limiter ?? new HostLimiter();
  }

  private async get(url: string, timeoutMs: number, headers: Record<string, string>, signal?: AbortSignal) {
    const host = hostOf(url);
    try {
      const out = await this.limiter.run(host, () => guardedFetch(url, { timeoutMs, headers, ...(signal ? { signal } : {}) }, this.opts.transport), signal);
      const failed = !out.ok ? out.reason !== 'cancelled' && out.reason !== 'csp' : out.status >= 500;
      this.limiter.report(host, !failed);
      return out;
    } catch {
      // The limiter only throws when the caller cancels while queued.
      return { ok: false as const, reason: 'cancelled' as const, detail: 'Cancelled.' };
    }
  }

  async dns(name: string, type: RRType, o: CallOpts = {}): Promise<LookupResult<DnsAnswer>> {
    const query = `${name} ${type}`;
    const order: ('cloudflare' | 'google')[] = this.opts.primaryResolver === 'google' ? ['google', 'cloudflare'] : ['cloudflare', 'google'];
    let last: LookupResult<DnsAnswer> | undefined;
    for (const resolver of order) {
      const { url, headers } = dohUrl(resolver, name, type);
      const source = hostOf(url);
      const out = await this.get(url, DNS_TIMEOUT, headers, o.signal);
      if (out.ok && out.status === 200) {
        const parsed = parseDohJson(tryJson(out.text), resolver, name, type);
        if (parsed) return { status: 'ok', kind: 'dns', query, source, url, at: nowUtc(), data: parsed, raw: out.text.slice(0, RAW_MAX) };
        last = blocked('dns', query, source, 'parse_error', 'The resolver answered, but the response could not be parsed.', url, manualDnsUrl(name, type));
      } else if (out.ok) {
        last = blocked('dns', query, source, 'http_error', `The resolver answered HTTP ${out.status}.`, url, manualDnsUrl(name, type));
      } else {
        last = blocked('dns', query, source, out.reason, out.detail, url, manualDnsUrl(name, type));
        if (out.reason === 'cancelled') return last;
      }
      // Fall through to the other resolver. This discloses the query to it as
      // well, which the README documents.
    }
    return last ?? blocked('dns', query, 'doh', 'unreachable', 'No resolver answered.', undefined, manualDnsUrl(name, type));
  }

  async rdapDomain(domain: string, o: CallOpts = {}): Promise<LookupResult<RdapDomain>> {
    const target = rdapDomainTarget(domain);
    if (target.kind === 'unsupported') {
      return blocked('rdap-domain', domain, 'IANA RDAP bootstrap', 'unsupported', target.reason, undefined, target.manualUrl);
    }
    const out = await this.get(target.url, RDAP_TIMEOUT, RDAP_ACCEPT, o.signal);
    const manual = target.url;
    const source = hostOf(target.url);
    if (!out.ok) return blocked('rdap-domain', domain, source, out.reason, `${out.detail} You can also try ICANN Lookup: ${icannLookupUrl(domain)}`, target.url, manual);
    if (out.status === 404) {
      return { status: 'not_found', kind: 'rdap-domain', query: domain, source, url: target.url, at: nowUtc(), evidence: `The registry's RDAP server (${source}) returned HTTP 404: no such domain is registered.` };
    }
    if (out.status !== 200) return blocked('rdap-domain', domain, source, 'http_error', `The registry's RDAP server answered HTTP ${out.status}.`, target.url, manual);
    const data = parseRdapDomain(tryJson(out.text), target.server);
    if (!data) return blocked('rdap-domain', domain, source, 'parse_error', 'The RDAP response could not be parsed.', target.url, manual);
    return { status: 'ok', kind: 'rdap-domain', query: domain, source, url: target.url, at: nowUtc(), data, raw: out.text.slice(0, RAW_MAX) };
  }

  async rdapIp(ip: string, o: CallOpts = {}): Promise<LookupResult<RdapNetwork>> {
    const target = rdapIpTarget(ip);
    if (target.kind === 'unsupported') return blocked('rdap-ip', ip, 'IANA RDAP bootstrap', 'unsupported', target.reason, undefined, target.manualUrl);
    const source = hostOf(target.url);
    const out = await this.get(target.url, RDAP_TIMEOUT, RDAP_ACCEPT, o.signal);
    if (!out.ok) return blocked('rdap-ip', ip, source, out.reason, out.detail, target.url, target.url);
    if (out.status === 404) {
      return { status: 'not_found', kind: 'rdap-ip', query: ip, source, url: target.url, at: nowUtc(), evidence: `The regional registry (${source}) returned HTTP 404 for this address.` };
    }
    if (out.status !== 200) return blocked('rdap-ip', ip, source, 'http_error', `The regional registry answered HTTP ${out.status}.`, target.url, target.url);
    const data = parseRdapNetwork(tryJson(out.text), hostOf(out.finalUrl));
    if (!data) return blocked('rdap-ip', ip, source, 'parse_error', 'The RDAP response could not be parsed.', target.url, target.url);
    return { status: 'ok', kind: 'rdap-ip', query: ip, source: hostOf(out.finalUrl), url: target.url, at: nowUtc(), data, raw: out.text.slice(0, RAW_MAX) };
  }

  async ctSearch(term: string, o: CallOpts & { mode?: 'prefix' | 'substring' } = {}): Promise<LookupResult<CtEntry[]>> {
    const mode = o.mode ?? 'prefix';
    const url = crtshUrl(term, mode);
    const manual = manualCrtshUrl(term, mode);
    const query = mode === 'substring' ? `%${term}% (names containing)` : `${term}% (names starting with)`;
    let out = await this.get(url, CT_TIMEOUT, { accept: 'application/json' }, o.signal);
    // crt.sh fails often; one retry (the limiter enforces the 12 s spacing).
    if ((!out.ok && out.reason !== 'cancelled' && out.reason !== 'csp') || (out.ok && out.status >= 500)) {
      out = await this.get(url, CT_TIMEOUT, { accept: 'application/json' }, o.signal);
    }
    if (!out.ok) return blocked('ct', query, 'crt.sh', out.reason, out.detail, url, manual);
    if (out.status !== 200) return blocked('ct', query, 'crt.sh', 'http_error', `crt.sh answered HTTP ${out.status}.`, url, manual);
    if (out.truncated) return blocked('ct', query, 'crt.sh', 'parse_error', 'The crt.sh result was too large to process in the browser. Narrow the search term or use the manual link.', url, manual);
    const entries = parseCrtsh(tryJson(out.text));
    if (!entries) return blocked('ct', query, 'crt.sh', 'parse_error', 'crt.sh returned something other than a JSON list (it often returns an HTML error page under load, or refuses the query form).', url, manual);
    return { status: 'ok', kind: 'ct', query, source: 'crt.sh', url, at: nowUtc(), data: entries };
  }

  async abuseContact(ip: string, o: CallOpts = {}): Promise<LookupResult<string[]>> {
    const name = abusixQueryName(ip);
    if (!name) return blocked('abuse', ip, 'Abusix Contact DB', 'unsupported', 'Not a valid public IP address.');
    const r = await this.dns(name, 'TXT', o);
    const base = { kind: 'abuse' as const, query: ip, source: `Abusix Contact DB via ${r.source}`, at: r.at, ...(r.url ? { url: r.url } : {}) };
    if (r.status === 'blocked') return { ...base, status: 'blocked', reason: r.reason, detail: r.detail, ...(r.manualUrl ? { manualUrl: r.manualUrl } : {}) };
    if (r.status === 'not_found') return { ...base, status: 'not_found', evidence: r.evidence };
    const emails = parseAbusixTxt(r.data);
    if (r.data.rcode === 3 || emails.length === 0) {
      return { ...base, status: 'not_found', evidence: 'The Abusix Contact DB has no abuse contact for this address.' };
    }
    return r.status === 'manual' ? { ...base, status: 'manual', data: emails, pastedText: r.pastedText } : { ...base, status: 'ok', data: emails };
  }
}
