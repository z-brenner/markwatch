// Provider inference from the fingerprint tables in src/config (PLAN §6.4).
// Output order is deterministic: DNS host(s), parking, web/CDN, mail — each
// group in table order. Every match says why (evidence).
import type { ProviderMatch, RdapNetwork } from '../types';
import { DNS_PROVIDERS, MAIL_PROVIDERS, WEB_PROVIDERS, type ProviderFingerprint } from '../../config/providers';
import { matchParking } from '../../config/parking';
import { hostHasSuffix, normalizeHost } from '../net/clean';
import { uniq } from '../util';

export interface ProviderInput {
  ns: string[];
  mx: string[];
  /** IP → network (from IP RDAP). */
  networks: Record<string, RdapNetwork>;
  ips: string[];
}

export interface ProviderTables {
  dns: readonly ProviderFingerprint[];
  web: readonly ProviderFingerprint[];
  mail: readonly ProviderFingerprint[];
}

const DEFAULT_TABLES: ProviderTables = { dns: DNS_PROVIDERS, web: WEB_PROVIDERS, mail: MAIL_PROVIDERS };

function toMatch(p: ProviderFingerprint, evidence: string): ProviderMatch {
  const m: ProviderMatch = { id: p.id, name: p.name, role: p.role, evidence };
  if (p.abuseUrl) m.abuseUrl = p.abuseUrl;
  if (p.abuseEmail) m.abuseEmail = p.abuseEmail;
  if (p.hidesOrigin) m.hidesOrigin = true;
  return m;
}

function hosts(list: string[]): string[] {
  return uniq(list.map((h) => normalizeHost(h)).filter((h): h is string => !!h && h !== '.'));
}

function listText(xs: string[]): string {
  return xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', ');
}

/** Matches hosts against a table's suffix (and regex) patterns. */
function matchHosts(table: readonly ProviderFingerprint[], list: string[], kind: 'NS' | 'MX'): ProviderMatch[] {
  const out: ProviderMatch[] = [];
  for (const p of table) {
    const suffixes = (kind === 'NS' ? p.match.nsSuffix : p.match.mxSuffix) ?? [];
    const regex = kind === 'NS' ? p.match.nsRegex : undefined;
    for (const suffix of suffixes) {
      const hit = list.filter((h) => hostHasSuffix(h, suffix));
      if (hit.length) {
        out.push(toMatch(p, `${kind} ${listText(hit)} ${hit.length === 1 ? 'ends' : 'end'} with .${suffix}`));
        break;
      }
    }
    if (regex && !out.some((m) => m.id === p.id)) {
      const hit = list.filter((h) => regex.test(h));
      if (hit.length) out.push(toMatch(p, `${kind} ${listText(hit)} ${hit.length === 1 ? 'matches' : 'match'} the ${p.name} nameserver pattern`));
    }
  }
  return out;
}

/** Web/CDN providers from the networks holding the domain's IPs. */
function matchNetworks(table: readonly ProviderFingerprint[], ips: string[], networks: Record<string, RdapNetwork>): ProviderMatch[] {
  const byProvider = new Map<string, { p: ProviderFingerprint; ips: string[]; holder: string }>();
  for (const ip of ips) {
    const net = Object.prototype.hasOwnProperty.call(networks, ip) ? networks[ip] : undefined;
    if (!net) continue;
    const texts = [net.org, net.name].filter((t): t is string => !!t);
    const p = table.find((f) => f.match.orgRegex && texts.some((t) => f.match.orgRegex?.test(t)));
    if (!p) continue;
    const holder = `${net.org ?? net.name ?? 'unknown holder'}${net.handle ? ` (RDAP network ${net.handle})` : ''}`;
    const entry = byProvider.get(p.id);
    if (entry) entry.ips.push(ip);
    else byProvider.set(p.id, { p, ips: [ip], holder });
  }
  // Table order, not IP order, so the result is stable.
  return table
    .filter((p) => byProvider.has(p.id))
    .map((p) => {
      const e = byProvider.get(p.id);
      const ipsText = e ? listText(uniq(e.ips)) : '';
      return toMatch(p, `IP ${ipsText} ${e && e.ips.length > 1 ? 'belong' : 'belongs'} to ${e?.holder ?? ''}`);
    });
}

/** Infers DNS, parking, web/CDN and mail providers. Deterministic for the same input. */
export function inferProviders(input: ProviderInput, tables: ProviderTables = DEFAULT_TABLES): ProviderMatch[] {
  const ns = hosts(input.ns);
  const mx = hosts(input.mx);
  const parking = matchParking(ns);
  return [
    ...matchHosts(tables.dns, ns, 'NS'),
    ...(parking ? [parking] : []),
    ...matchNetworks(tables.web, uniq(input.ips), input.networks),
    ...matchHosts(tables.mail, mx, 'MX'),
  ];
}
