// Derives DomainFacts from a domain record's lookups. Pure: the same lookups
// always produce the same facts, so facts are recomputed rather than stored
// independently of their evidence.
import { aRecords, aaaaRecords, mxHosts, nsHosts, txtRecords } from '../core/dns/doh';
import { decideVerdict } from '../core/resolve/verdict';
import { isWildcard } from '../core/resolve/wildcard';
import { inferProviders } from '../core/resolve/providers';
import { matchParking } from '../config/parking';
import type { CheckState, CtEntry, DnsAnswer, DomainFacts, DomainRecord, FactChecks, LookupResult, RdapDomain, RdapNetwork, RRType } from '../core/types';

type AnyLookup = LookupResult<unknown>;

export const WILDCARD_PREFIX = 'mw-';

/** Latest lookup matching a predicate (lookups are appended in time order). */
export function latest(lookups: readonly AnyLookup[], pred: (l: AnyLookup) => boolean): AnyLookup | undefined {
  for (let i = lookups.length - 1; i >= 0; i--) {
    const l = lookups[i]!;
    if (pred(l)) return l;
  }
  return undefined;
}

export const dnsQuery = (name: string, type: RRType) => `${name} ${type}`;

function dnsData(l: AnyLookup | undefined): DnsAnswer | undefined {
  return l && (l.status === 'ok' || l.status === 'manual') && l.kind === 'dns' ? (l.data as DnsAnswer) : undefined;
}

export function latestDns(rec: DomainRecord, name: string, type: RRType): LookupResult<DnsAnswer> | undefined {
  return latest(rec.lookups, (l) => l.kind === 'dns' && l.query === dnsQuery(name, type)) as LookupResult<DnsAnswer> | undefined;
}

export function latestRdap(rec: DomainRecord): LookupResult<RdapDomain> | undefined {
  return latest(rec.lookups, (l) => l.kind === 'rdap-domain' && l.query === rec.registrable) as LookupResult<RdapDomain> | undefined;
}

/**
 * answered: a readable answer (including NXDOMAIN / RDAP 404 / user-pasted data).
 * unavailable: the latest attempt was blocked, or the resolver could not answer (SERVFAIL etc.).
 */
function check(l: AnyLookup | undefined): CheckState {
  if (!l) return 'not_checked';
  if (l.status === 'blocked') return l.reason === 'cancelled' ? 'not_checked' : 'unavailable';
  if (l.kind === 'dns' && (l.status === 'ok' || l.status === 'manual')) {
    const rcode = (l.data as DnsAnswer).rcode;
    return rcode === 0 || rcode === 3 ? 'answered' : 'unavailable';
  }
  return 'answered';
}

export function buildFacts(rec: DomainRecord): DomainFacts {
  const nsL = latestDns(rec, rec.registrable, 'NS');
  const rdapL = latestRdap(rec);
  const { verdict, reason } = decideVerdict({ ...(nsL ? { ns: nsL } : {}), ...(rdapL ? { rdap: rdapL } : {}) });

  const nsAns = dnsData(nsL);
  const aL = latestDns(rec, rec.domain, 'A');
  const aaaaL = latestDns(rec, rec.domain, 'AAAA');
  const mxL = latestDns(rec, rec.domain, 'MX');
  const txtL = latestDns(rec, rec.domain, 'TXT');
  const a = dnsData(aL);
  const aaaa = dnsData(aaaaL);
  const mx = dnsData(mxL);
  const txt = dnsData(txtL);
  const wild = dnsData(latest(rec.lookups, (l) => l.kind === 'dns' && l.query.startsWith(WILDCARD_PREFIX) && l.query.endsWith(`.${rec.registrable} A`)));

  const rdap = rdapL && (rdapL.status === 'ok' || rdapL.status === 'manual') ? rdapL.data : undefined;
  const ns = nsAns ? nsHosts(nsAns) : rdap ? rdap.nameservers : [];
  const ips = [...(a ? aRecords(a) : []), ...(aaaa ? aaaaRecords(aaaa) : [])];

  const networks: Record<string, RdapNetwork> = {};
  const abusix: Record<string, string[]> = {};
  const netStates: CheckState[] = [];
  for (const ip of ips) {
    const n = latest(rec.lookups, (l) => l.kind === 'rdap-ip' && l.query === ip);
    netStates.push(check(n));
    if (n && (n.status === 'ok' || n.status === 'manual')) networks[ip] = n.data as RdapNetwork;
    const ab = latest(rec.lookups, (l) => l.kind === 'abuse' && l.query === ip);
    if (ab && (ab.status === 'ok' || ab.status === 'manual')) abusix[ip] = ab.data as string[];
  }

  const ct: CtEntry[] = [];
  const seen = new Set<number>();
  for (const l of rec.lookups) {
    if (l.kind === 'ct' && (l.status === 'ok' || l.status === 'manual')) {
      for (const e of l.data as CtEntry[]) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        ct.push(e);
      }
    }
  }

  const mxList = mx ? mxHosts(mx) : [];
  const providers = inferProviders({ ns, mx: mxList, networks, ips });
  const parking = matchParking(ns);
  if (parking && !providers.some((p) => p.role === 'parking')) providers.push(parking);

  const dnssecFailure = !!nsAns && nsAns.rcode === 2 && /dnssec|bogus|signature|rrsig/i.test(nsAns.comment ?? '');
  const checks: FactChecks = {
    ns: check(nsL),
    a: check(aL),
    aaaa: check(aaaaL),
    mx: check(mxL),
    txt: check(txtL),
    rdap: check(rdapL),
    networks: netStates.length === 0 ? 'not_checked' : netStates.includes('unavailable') ? 'unavailable' : netStates.includes('not_checked') ? 'not_checked' : 'answered',
    ct: rec.lookups.some((l) => l.kind === 'ct' && (l.status === 'ok' || l.status === 'manual')) ? 'answered' : 'not_checked',
  };

  return {
    verdict,
    checks,
    verdictReason: reason,
    ns,
    a: a ? aRecords(a) : [],
    aaaa: aaaa ? aaaaRecords(aaaa) : [],
    mx: mxList,
    txt: txt ? txtRecords(txt) : [],
    ...(wild ? { wildcard: isWildcard(wild) } : {}),
    ...(dnssecFailure ? { dnssecFailure } : {}),
    ...(rdap ? { rdap } : {}),
    networks,
    abusix,
    providers,
    ct,
  };
}

/** Registered for enrichment purposes: worth spending A/MX/RDAP queries on. */
export function worthEnriching(verdict: DomainFacts['verdict']): boolean {
  return verdict === 'registered' || verdict === 'registered_broken_dns';
}
