// RDAP routing from the IANA bootstrap (RFC 9224). The bundled snapshot in
// src/data is authoritative for the app; it is also the source of the CSP
// allowlist, so a URL built here is always one the browser may fetch.
//
// Domains: longest label-wise suffix match (".co.uk" would beat ".uk" if both
// were listed). IP addresses: longest-prefix CIDR match.
import data from '../../data/rdap-bootstrap.json' with { type: 'json' };
import { asArray, isRecord } from '../net/clean';
import { ipv4FromMapped, ipv4InCidr, ipv6InCidr, isIPv4, isIPv6, parseCidr } from '../net/ip';

/** One bootstrap service: [keys (TLDs or CIDRs), base URLs ending in "/"]. */
export type BootstrapService = readonly [readonly string[], readonly string[]];

export interface BootstrapFile {
  publication: string;
  services: readonly BootstrapService[];
}

export interface RdapBootstrap {
  dns: BootstrapFile;
  ipv4: BootstrapFile;
  ipv6: BootstrapFile;
  asn?: BootstrapFile;
}

export type RdapTarget = { kind: 'ok'; url: string; server: string } | { kind: 'unsupported'; reason: string; manualUrl: string };

/**
 * Validates one bootstrap file, either the compact bundled form or IANA's own
 * format (`{ version, publication, services }`). Keeps only https base URLs and
 * normalizes them to end in "/". Returns null when the shape is wrong.
 */
export function parseBootstrapFile(json: unknown): BootstrapFile | null {
  if (!isRecord(json) || !Array.isArray(json.services)) return null;
  const publication = typeof json.publication === 'string' ? json.publication : '';
  const services: BootstrapService[] = [];
  for (const s of asArray(json.services, 5000)) {
    if (!Array.isArray(s) || !Array.isArray(s[0]) || !Array.isArray(s[1])) continue;
    const keys = asArray(s[0], 5000).filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 100).map((k) => k.toLowerCase());
    const urls = asArray(s[1], 20)
      .filter((u): u is string => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s?#]*)?$/i.test(u))
      .map((u) => (u.endsWith('/') ? u : `${u}/`));
    if (keys.length) services.push([keys, urls]);
  }
  return { publication, services };
}

function bundledBootstrap(): RdapBootstrap {
  const empty: BootstrapFile = { publication: '', services: [] };
  return {
    dns: parseBootstrapFile(data.dns) ?? empty,
    ipv4: parseBootstrapFile(data.ipv4) ?? empty,
    ipv6: parseBootstrapFile(data.ipv6) ?? empty,
    asn: parseBootstrapFile(data.asn) ?? empty,
  };
}

/** The snapshot shipped with this build (see scripts/update-bootstrap.mjs). */
export const BUNDLED_BOOTSTRAP: RdapBootstrap = bundledBootstrap();

/**
 * Registry web WHOIS pages for common TLDs that have no RDAP service in the
 * bootstrap. Each URL was opened and checked on 2026-10-05. Anything not listed
 * falls back to the IANA root-zone page, which names the registry and its WHOIS.
 */
export const REGISTRY_WHOIS: Readonly<Record<string, string>> = {
  de: 'https://webwhois.denic.de/?lang=en',
  eu: 'https://whois.eurid.eu/en/',
  jp: 'https://whois.jprs.jp/en/',
  cn: 'https://webwhois.cnnic.cn/',
};

/** IANA root-zone database page for a TLD (lists the registry and its WHOIS server). */
export function ianaTldUrl(tld: string): string {
  return `https://www.iana.org/domains/root/db/${encodeURIComponent(tld.toLowerCase())}.html`;
}

/** ICANN's lookup tool: a manual alternative for gTLDs (it follows RDAP referrals). */
export function icannLookupUrl(domain: string): string {
  return `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`;
}

/** IANA's web WHOIS for an IP address; it names the responsible RIR. */
export function ianaWhoisUrl(query: string): string {
  return `https://www.iana.org/whois?q=${encodeURIComponent(query)}`;
}

// TLD → base URLs, built once per bootstrap file.
const dnsIndexCache = new WeakMap<BootstrapFile, Map<string, readonly string[]>>();
function dnsIndex(file: BootstrapFile): Map<string, readonly string[]> {
  let index = dnsIndexCache.get(file);
  if (!index) {
    index = new Map();
    for (const [keys, urls] of file.services) for (const k of keys) if (!index.has(k)) index.set(k, urls);
    dnsIndexCache.set(file, index);
  }
  return index;
}

const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

function normalizeDomain(input: string): string | null {
  if (typeof input !== 'string') return null;
  const d = input.trim().toLowerCase().replace(/\.$/, '');
  if (!d || d.length > 253) return null;
  const labels = d.split('.');
  return labels.every((l) => LABEL.test(l)) ? d : null;
}

/**
 * Where to ask about an ASCII (punycode) domain. Unsupported when the TLD has
 * no https RDAP service in the bootstrap; that must never be read as
 * "unregistered", so the result carries a manual lookup URL.
 */
export function rdapDomainTarget(domainAscii: string, bootstrap: RdapBootstrap = BUNDLED_BOOTSTRAP): RdapTarget {
  const domain = normalizeDomain(domainAscii);
  if (!domain) {
    return { kind: 'unsupported', reason: 'Not a valid ASCII domain name.', manualUrl: icannLookupUrl(String(domainAscii).slice(0, 253)) };
  }
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] ?? domain;
  const index = dnsIndex(bootstrap.dns);

  // Longest suffix first: for a.b.c try "a.b.c", "b.c", then "c".
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    const urls = index.get(suffix);
    if (!urls) continue;
    const base = urls[0];
    if (!base) {
      return {
        kind: 'unsupported',
        reason: `The RDAP service for .${suffix} is listed only over plain http, which this app cannot use.`,
        manualUrl: (Object.hasOwn(REGISTRY_WHOIS, tld) ? REGISTRY_WHOIS[tld] : undefined) ?? ianaTldUrl(tld),
      };
    }
    return { kind: 'ok', url: `${base}domain/${domain}`, server: base };
  }
  return {
    kind: 'unsupported',
    reason: `No RDAP service for .${tld} in the IANA bootstrap. This says nothing about whether ${domain} is registered; check the registry's WHOIS.`,
    manualUrl: (Object.hasOwn(REGISTRY_WHOIS, tld) ? REGISTRY_WHOIS[tld] : undefined) ?? ianaTldUrl(tld),
  };
}

/**
 * IANA special-purpose ranges (RFC 6890 and successors) that no RIR answers
 * for usefully. Some sit inside legacy /8s that the bootstrap maps to ARIN
 * (192.168.0.0/16 is in 192.0.0.0/8), so they are checked first.
 */
export const SPECIAL_PURPOSE_CIDRS: readonly string[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/127',
  '64:ff9b::/96',
  '100::/64',
  '2001:db8::/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

function isSpecialPurpose(addr: string, v4: boolean): boolean {
  return SPECIAL_PURPOSE_CIDRS.some((c) => (v4 ? ipv4InCidr(addr, c) : ipv6InCidr(addr, c)));
}

/**
 * Where to ask about an IP address: the RIR whose bootstrap entry has the
 * longest matching prefix. IPv4-mapped IPv6 is routed as IPv4. Private,
 * reserved and special-purpose space is unsupported.
 */
export function rdapIpTarget(ip: string, bootstrap: RdapBootstrap = BUNDLED_BOOTSTRAP): RdapTarget {
  const raw = typeof ip === 'string' ? ip.trim().toLowerCase() : '';
  const addr = (isIPv6(raw) && ipv4FromMapped(raw)) || raw;
  const v4 = isIPv4(addr);
  if (!v4 && !isIPv6(addr)) {
    return { kind: 'unsupported', reason: 'Not a valid IP address.', manualUrl: ianaWhoisUrl(raw.slice(0, 64)) };
  }
  if (isSpecialPurpose(addr, v4)) {
    return {
      kind: 'unsupported',
      reason: `${addr} is a private, reserved or special-purpose address; no registry holds it.`,
      manualUrl: ianaWhoisUrl(addr),
    };
  }
  const file = v4 ? bootstrap.ipv4 : bootstrap.ipv6;
  const inCidr = v4 ? ipv4InCidr : ipv6InCidr;
  let best: { prefix: number; base: string | undefined } | null = null;
  for (const [keys, urls] of file.services) {
    for (const k of keys) {
      const c = parseCidr(k);
      if (!c || c.version !== (v4 ? 4 : 6) || (best && c.prefix <= best.prefix)) continue;
      if (inCidr(addr, k)) best = { prefix: c.prefix, base: urls[0] };
    }
  }
  if (!best) {
    return {
      kind: 'unsupported',
      reason: `${addr} is not in any regional internet registry's space in the IANA bootstrap (private, reserved or special-purpose address).`,
      manualUrl: ianaWhoisUrl(addr),
    };
  }
  if (!best.base) {
    return { kind: 'unsupported', reason: `The RDAP service for ${addr} is listed only over plain http.`, manualUrl: ianaWhoisUrl(addr) };
  }
  return { kind: 'ok', url: `${best.base}ip/${addr}`, server: best.base };
}
