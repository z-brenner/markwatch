// Dispute-policy facts by TLD. Sources (checked 2026-10-05, see PLAN.md §17):
//  - URS applies under the ICANN base gTLD Registry Agreement (post-2012
//    gTLDs) and was adopted by .org, .info and .biz in their 2019 renewals.
//    .com and .net agreements contain no URS provisions. Other legacy gTLDs
//    are unverified.
//  - UDRP binds all ICANN-accredited registrars for gTLD registrations;
//    ccTLD registries set their own policies (some adopt UDRP, many run their
//    own DRP).
//  - Internationalized TLDs (xn--…) can be IDN ccTLDs (e.g. xn--p1ai = .рф)
//    or IDN gTLDs. Nothing here can tell which, so both checks say "verify".
//
// This module is the single source of truth for URS/UDRP eligibility; the
// draft context (urs.eligible) derives its text from ursEligibility below.

/** Legacy gTLDs whose registry agreements contain no URS provisions. */
const NO_URS_LEGACY = new Set(['com', 'net']);
/** Restricted TLDs outside ICANN's gTLD registry agreements and the UDRP. */
const RESTRICTED = new Set(['edu', 'gov', 'mil', 'int', 'arpa']);
/** Legacy gTLDs verified to have adopted URS in their registry agreements. */
const LEGACY_WITH_URS = new Set(['org', 'info', 'biz']);
/** Other pre-2012 gTLDs whose URS status we have not verified. */
const LEGACY_UNVERIFIED = new Set(['aero', 'asia', 'cat', 'coop', 'jobs', 'mobi', 'museum', 'name', 'pro', 'tel', 'travel', 'xxx', 'post']);

/** Last label of a domain, lowercased, ignoring a trailing root dot. */
export function tldOf(domain: string): string {
  const d = domain.trim().replace(/\.$/, '');
  const i = d.lastIndexOf('.');
  return (i >= 0 ? d.slice(i + 1) : d).toLowerCase();
}

/**
 * Two-letter ASCII TLDs are country codes. IDN ccTLDs (xn--…) cannot be told
 * apart from IDN gTLDs by their form, so this returns false for them; callers
 * check isIdnTld separately and treat them as "verify".
 */
export function isCcTld(tld: string): boolean {
  return /^[a-z]{2}$/.test(tld);
}

/** Internationalized TLD in A-label form: an IDN ccTLD or an IDN gTLD. */
export function isIdnTld(tld: string): boolean {
  return tld.startsWith('xn--');
}

export type Eligibility = { eligible: 'yes' | 'no' | 'verify'; note: string };

const IDN_NOTE = (tld: string): string =>
  `.${tld} is an internationalized (IDN) TLD. It may be an IDN country-code TLD (for example .xn--p1ai, the Cyrillic .рф), whose registry sets its own dispute policy, or an IDN gTLD bound by ICANN policies. Check the IANA root zone database for its type and the registry's dispute policy.`;

export function ursEligibility(domain: string): Eligibility {
  const tld = tldOf(domain);
  if (tld === '' || !/^[a-z0-9-]+$/.test(tld)) return { eligible: 'verify', note: 'Could not determine the TLD; check the registry’s dispute policy.' };
  if (isIdnTld(tld)) return { eligible: 'verify', note: `${IDN_NOTE(tld)} URS applies only if it is a gTLD covered by the base Registry Agreement.` };
  if (isCcTld(tld)) {
    return {
      eligible: 'verify',
      note: `.${tld} is a country-code TLD. URS is an ICANN gTLD procedure and does not bind ccTLD registries, though a few have adopted it voluntarily; check the .${tld} registry's dispute policy.`,
    };
  }
  if (NO_URS_LEGACY.has(tld)) return { eligible: 'no', note: `The .${tld} registry agreement does not include URS.` };
  if (RESTRICTED.has(tld)) return { eligible: 'no', note: `.${tld} is a restricted TLD outside ICANN's gTLD registry agreements; URS does not apply.` };
  if (LEGACY_WITH_URS.has(tld)) return { eligible: 'yes', note: `.${tld} adopted URS in its 2019 registry agreement renewal.` };
  if (LEGACY_UNVERIFIED.has(tld)) return { eligible: 'verify', note: `.${tld} is a legacy gTLD; confirm URS applies before relying on it.` };
  return { eligible: 'yes', note: `.${tld} appears to be a post-2012 gTLD, which is bound by URS under the base Registry Agreement (verify for this TLD).` };
}

export function udrpEligibility(domain: string): Eligibility {
  const tld = tldOf(domain);
  if (tld === '' || !/^[a-z0-9-]+$/.test(tld)) return { eligible: 'verify', note: 'Could not determine the TLD; check the registry’s dispute policy.' };
  if (isIdnTld(tld)) return { eligible: 'verify', note: `${IDN_NOTE(tld)} UDRP applies if it is a gTLD; if it is a ccTLD, check whether its registry has adopted UDRP.` };
  if (isCcTld(tld)) {
    return { eligible: 'verify', note: `.${tld} is a country-code TLD. Its registry sets its own dispute policy (some adopt UDRP; many run their own, e.g. Nominet DRS for .uk, CIRA CDRP for .ca).` };
  }
  if (RESTRICTED.has(tld)) return { eligible: 'no', note: `.${tld} is a restricted TLD outside the UDRP.` };
  return { eligible: 'yes', note: 'UDRP applies to domains registered through ICANN-accredited registrars in gTLDs.' };
}
