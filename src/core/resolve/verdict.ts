// "Is it registered?" — the decision table of PLAN §6.1.
//
// Precedence: a readable registry RDAP answer is authoritative and wins over
// DNS. Then the NS answer at the registrable domain. A blocked lookup is never
// turned into "unregistered", and NXDOMAIN is never "available": domains on
// hold, in redemption or registered without nameservers are absent from the
// zone. Only a readable RDAP 404 yields "available".
import type { DnsAnswer, LookupResult, RdapDomain, RegistrationVerdict } from '../types';
import { RR_CODES } from '../types';

export interface VerdictInput {
  ns?: LookupResult<DnsAnswer>;
  rdap?: LookupResult<RdapDomain>;
}

export interface Verdict {
  verdict: RegistrationVerdict;
  reason: string;
}

/** EPP statuses that keep a registered domain out of the DNS, keyed by compacted lowercase form. */
const OFF_ZONE_STATUSES: Readonly<Record<string, string>> = {
  clienthold: 'clientHold (suspended by the registrar)',
  serverhold: 'serverHold (suspended by the registry)',
  redemptionperiod: 'redemptionPeriod (expired, can still be restored by the registrant)',
  pendingdelete: 'pendingDelete (about to be deleted and released)',
};

/** "client hold", "clientHold", "CLIENT_HOLD" → "clienthold". */
function compactStatus(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function sourceOf(r: LookupResult<unknown>): string {
  return r.status === 'manual' ? 'pasted by the user' : r.source;
}

const RCODE_NAMES: Readonly<Record<number, string>> = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

function norm(name: string): string {
  return name.toLowerCase().replace(/\.$/, '');
}

const NOT_PROOF =
  'This is not proof that it is unregistered: domains on clientHold or serverHold, in redemption, or registered without nameservers are absent from the zone too. Verify with RDAP before treating it as available.';

function fromRdap(rdap: LookupResult<RdapDomain>): Verdict | null {
  if (rdap.status === 'ok' || rdap.status === 'manual') {
    const d = rdap.data;
    const status = d.status.length ? ` Status: ${d.status.join(', ')}.` : '';
    const offZone = d.status.map((s) => OFF_ZONE_STATUSES[compactStatus(s)]).filter((s): s is string => !!s);
    const note = offZone.length ? ` Note: the status includes ${offZone.join(' and ')}, so the domain may not resolve even though it is registered.` : '';
    return {
      verdict: 'registered',
      reason: `Registry RDAP (${sourceOf(rdap)}) has a record for ${d.ldhName}.${status}${note}`,
    };
  }
  if (rdap.status === 'not_found') {
    return {
      verdict: 'available',
      reason: `Registry RDAP returned 404 (not found) from ${rdap.source}: the registry has no record of this domain, so it appears available to register.${rdap.evidence ? ` Evidence: ${rdap.evidence}` : ''}`,
    };
  }
  return null;
}

function fromNs(ns: LookupResult<DnsAnswer>): Verdict | null {
  if (ns.status === 'not_found') {
    return { verdict: 'not_delegated', reason: `NS lookup via ${ns.source} returned NXDOMAIN: the name is not in the zone. ${NOT_PROOF}` };
  }
  if (ns.status !== 'ok' && ns.status !== 'manual') return null;
  const a = ns.data;
  const via = sourceOf(ns);
  switch (a.rcode) {
    case 0: {
      const owner = norm(a.name);
      const nsRecords = a.answers.filter((r) => r.type === RR_CODES.NS && norm(r.name) === owner && r.data.length > 0);
      if (nsRecords.length > 0) {
        const hosts = [...new Set(nsRecords.map((r) => r.data))];
        return { verdict: 'registered', reason: `NS lookup via ${via} returned ${hosts.length} nameserver(s) for ${a.name}: ${hosts.join(', ')}.` };
      }
      const soa = a.authority.find((r) => r.type === RR_CODES.SOA);
      return {
        verdict: 'probably_unregistered',
        reason: `NS lookup via ${via} returned NOERROR with no nameservers for ${a.name}${soa ? ` (only an SOA for ${soa.name || 'the parent zone'})` : ''}. Probably unregistered; RDAP can confirm.`,
      };
    }
    case 3:
      return { verdict: 'not_delegated', reason: `NS lookup via ${via} returned NXDOMAIN: ${a.name} is not in the zone. ${NOT_PROOF}` };
    case 2:
      return {
        verdict: 'registered_broken_dns',
        reason: `NS lookup via ${via} returned SERVFAIL for ${a.name}: the domain appears registered but its DNS is broken (lame delegation or DNSSEC failure).${a.comment ? ` Resolver said: ${a.comment}` : ''}`,
      };
    default:
      return {
        verdict: 'unknown',
        reason: `NS lookup via ${via} returned RCODE ${a.rcode}${RCODE_NAMES[a.rcode] ? ` (${RCODE_NAMES[a.rcode]})` : ''}, which says nothing about registration.`,
      };
  }
}

function blockedText(r: LookupResult<unknown> | undefined, label: string): string | null {
  return r?.status === 'blocked' ? `${label} lookup was blocked (${r.reason}: ${r.detail})` : null;
}

/** Applies the PLAN §6.1 decision table. Pure; never throws. */
export function decideVerdict(input: VerdictInput): Verdict {
  const { ns, rdap } = input;
  const byRdap = rdap ? fromRdap(rdap) : null;
  if (byRdap) return byRdap;
  const byNs = ns ? fromNs(ns) : null;
  if (byNs) return byNs;
  const blocked = [blockedText(ns, 'NS'), blockedText(rdap, 'RDAP')].filter((s): s is string => !!s);
  if (blocked.length) {
    return { verdict: 'blocked', reason: `${blocked.join('; ')}. No readable answer, so registration is unknown — this is not "unregistered".` };
  }
  return { verdict: 'unknown', reason: 'No lookup has produced an answer yet.' };
}
