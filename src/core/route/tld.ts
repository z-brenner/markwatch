// Dispute-policy facts by TLD. Sources (checked 2026-10-05, see PLAN.md §17):
//  - URS applies under the ICANN base gTLD Registry Agreement (all post-2012
//    gTLDs) and was adopted by .org, .info and .biz in their 2019 renewals.
//    .com and .net agreements contain no URS provisions.
//  - UDRP binds all ICANN-accredited gTLD registrars; ccTLDs set their own
//    policies (some adopt UDRP, most run their own DRP).

/** Legacy gTLDs without URS (as far as verified) and restricted TLDs where URS/UDRP don't meaningfully apply. */
const NO_URS = new Set(['com', 'net', 'edu', 'gov', 'mil', 'int', 'arpa']);
/** Legacy gTLDs verified to have adopted URS in their registry agreements. */
const LEGACY_WITH_URS = new Set(['org', 'info', 'biz']);
/** Other pre-2012 gTLDs whose URS status we have not verified. */
const LEGACY_UNVERIFIED = new Set(['aero', 'asia', 'cat', 'coop', 'jobs', 'mobi', 'museum', 'name', 'pro', 'tel', 'travel', 'xxx', 'post']);

export function tldOf(domain: string): string {
  const i = domain.lastIndexOf('.');
  return (i >= 0 ? domain.slice(i + 1) : domain).toLowerCase();
}

/** Two-letter ASCII TLDs are country codes; IDN ccTLDs (xn--…) are not detected here and fall back to "verify". */
export function isCcTld(tld: string): boolean {
  return /^[a-z]{2}$/.test(tld);
}

export type Eligibility = { eligible: 'yes' | 'no' | 'verify'; note: string };

export function ursEligibility(domain: string): Eligibility {
  const tld = tldOf(domain);
  if (isCcTld(tld)) return { eligible: 'no', note: `.${tld} is a country-code TLD; URS applies only to gTLDs.` };
  if (NO_URS.has(tld)) return { eligible: 'no', note: `The .${tld} registry agreement does not include URS.` };
  if (LEGACY_WITH_URS.has(tld)) return { eligible: 'yes', note: `.${tld} adopted URS in its 2019 registry agreement renewal.` };
  if (LEGACY_UNVERIFIED.has(tld)) return { eligible: 'verify', note: `.${tld} is a legacy gTLD; confirm URS applies before relying on it.` };
  return { eligible: 'yes', note: `.${tld} appears to be a post-2012 gTLD, which is bound by URS under the base Registry Agreement (verify for this TLD).` };
}

export function udrpEligibility(domain: string): Eligibility {
  const tld = tldOf(domain);
  if (isCcTld(tld)) {
    return { eligible: 'verify', note: `.${tld} is a country-code TLD. Its registry sets its own dispute policy (some adopt UDRP; many run their own, e.g. Nominet DRS for .uk, CIRA CDRP for .ca).` };
  }
  if (tld === 'gov' || tld === 'mil' || tld === 'edu' || tld === 'int' || tld === 'arpa') {
    return { eligible: 'no', note: `.${tld} is a restricted TLD outside the UDRP.` };
  }
  return { eligible: 'yes', note: 'UDRP applies to domains registered through ICANN-accredited registrars in gTLDs.' };
}
