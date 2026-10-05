// Remedy routing: (classification, facts) → recommended route with an
// explanation, the contacts we found (each with its source), escalation
// options, warnings, and the templates the class may use.
//
// This is the legal-judgment layer. Two rules are absolute and tested:
//  - "Authorized but noncompliant" only ever gets an internal compliance note.
//  - "Possible fair use or criticism" unlocks no outbound template until the
//    user records that counsel was consulted.
import type {
  Classification,
  DomainFacts,
  InventoryKind,
  Route,
  RouteContact,
  RouteEscalation,
  RouteStep,
  RouteWarning,
  TemplateId,
} from '../types';
import { CLASSIFICATION_LABELS } from '../types';
import { udrpEligibility, ursEligibility, isCcTld, tldOf } from './tld';

export interface RouteInput {
  domain: string;
  facts?: DomainFacts;
  inventory?: { kind: InventoryKind; party?: string };
  /** Earliest mark-rights date the user entered (ISO date), used for the reverse-hijacking check. */
  earliestRightsDate?: string;
  /** Lookup sources keyed by kind, used to cite where a contact came from. */
  rdapSource?: string;
}

const DMCA_COPYRIGHT_ONLY =
  'The DMCA covers copyright, not trademark. Use a DMCA notice only for copied text, images, code or other works you own or are authorized to enforce. Trademark-only complaints do not belong in a DMCA notice.';

// ─── contacts ───

function registrarContact(input: RouteInput): RouteContact {
  const r = input.facts?.rdap?.registrar;
  const server = input.facts?.rdap?.server;
  if (r && r.abuseEmail.length) {
    return {
      label: `Registrar abuse: ${r.name ?? 'unknown registrar'}${r.ianaId ? ` (IANA ID ${r.ianaId})` : ''}`,
      email: r.abuseEmail,
      source: `RDAP ${server ?? input.rdapSource ?? 'registry'} (registrar abuse role)`,
    };
  }
  return {
    label: r?.name ? `Registrar abuse: ${r.name} (no abuse email in RDAP)` : 'Registrar abuse contact unknown',
    email: [],
    source: input.facts?.rdap ? `RDAP ${server ?? ''}`.trim() : 'RDAP unavailable for this domain: use the manual lookup or ICANN Lookup',
  };
}

function hostContacts(input: RouteInput): RouteContact[] {
  const f = input.facts;
  if (!f) return [];
  const out: RouteContact[] = [];
  const cdn = f.providers.find((p) => p.hidesOrigin);
  if (cdn) {
    out.push({
      label: `${cdn.name} (reverse proxy / CDN: hides the origin host)`,
      email: cdn.abuseEmail ? [cdn.abuseEmail] : [],
      ...(cdn.abuseUrl ? { url: cdn.abuseUrl } : {}),
      source: `Provider inference: ${cdn.evidence}`,
    });
  }
  for (const [ip, net] of Object.entries(f.networks)) {
    if (net.abuseEmail.length || net.org) {
      out.push({
        label: `Network abuse for ${ip}: ${net.org ?? net.name ?? 'unknown network'}`,
        email: net.abuseEmail,
        source: `RDAP ${net.server} (abuse role)`,
      });
    }
  }
  for (const [ip, emails] of Object.entries(f.abusix)) {
    if (emails.length) out.push({ label: `Abuse contact for ${ip}`, email: emails, source: 'Abusix Contact DB (DNS TXT via DoH)' });
  }
  return out;
}

function parkingContact(input: RouteInput): RouteContact | undefined {
  const p = input.facts?.providers.find((x) => x.role === 'parking');
  if (!p) return undefined;
  return {
    label: `Parking provider: ${p.name}`,
    email: p.abuseEmail ? [p.abuseEmail] : [],
    ...(p.trademarkComplaintUrl ? { url: p.trademarkComplaintUrl } : {}),
    source: `Nameserver match: ${p.evidence}`,
  };
}

// ─── escalations ───

function escalations(domain: string): RouteEscalation[] {
  const udrp = udrpEligibility(domain);
  const urs = ursEligibility(domain);
  const tld = tldOf(domain);
  const out: RouteEscalation[] = [
    {
      id: 'udrp',
      title: 'UDRP complaint',
      explanation: 'Administrative proceeding (WIPO, Forum and others) that can transfer or cancel the domain. Requires all three UDRP ¶4(a) elements.',
      available: udrp.eligible !== 'no',
      note: udrp.note,
    },
    {
      id: 'urs',
      title: 'URS complaint',
      explanation: 'Faster, cheaper, clear-and-convincing standard; the remedy is suspension only (no transfer).',
      available: urs.eligible !== 'no',
      note: urs.note,
    },
  ];
  if (isCcTld(tld)) {
    out.push({
      id: 'cctld-drp',
      title: `.${tld} dispute resolution policy`,
      explanation: `Check the .${tld} registry's own dispute policy and its eligibility rules.`,
      available: true,
      note: 'See the registry listed in the IANA root zone database.',
    });
  }
  out.push({
    id: 'acpa',
    title: 'ACPA action (15 U.S.C. § 1125(d))',
    explanation: 'US federal civil action. Remedies include transfer or cancellation and statutory damages of $1,000 to $100,000 per domain (§ 1117(d)). An in rem action is possible when the registrant cannot be found (§ 1125(d)(2)).',
    available: true,
    note: 'Litigation. Requires counsel.',
  });
  return out;
}

// ─── warnings ───

function rdnhWarning(input: RouteInput): RouteWarning | undefined {
  const reg = input.facts?.rdap?.registered;
  const rights = input.earliestRightsDate;
  if (!reg) {
    return { id: 'rdnh-unknown', level: 'info', dismissible: true, text: 'Registration date unknown. Before escalating, confirm the domain was not registered before your mark rights arose (reverse domain name hijacking risk).' };
  }
  if (rights && Date.parse(reg) < Date.parse(rights)) {
    return {
      id: 'rdnh',
      level: 'danger',
      dismissible: false,
      text: `The domain was registered (${reg.slice(0, 10)}) before your earliest recorded mark rights (${rights}). Bad-faith registration is hard to show, and an aggressive complaint risks a finding of Reverse Domain Name Hijacking. Consult counsel.`,
    };
  }
  return undefined;
}

// ─── routes ───

function step(id: string, title: string, explanation: string, contacts: RouteContact[], templates: TemplateId[]): RouteStep {
  return { id, title, explanation, contacts, templates };
}

function base(classification: Classification, headline: string): Route {
  return { classification, headline, why: [], steps: [], escalations: [], warnings: [], allowedTemplates: [] };
}

export function routeFor(classification: Classification, input: RouteInput): Route {
  const r = routeByClass(classification, input);
  r.allowedTemplates = [...new Set(r.steps.flatMap((s) => s.templates))];

  if (input.inventory?.kind === 'owned') {
    // Owned domains are excluded from enforcement whatever the classification.
    r.warnings.unshift({ id: 'inventory-owned', level: 'danger', dismissible: false, text: 'This domain is on your owned-domains list. It is excluded from enforcement.' });
    r.allowedTemplates = [];
    for (const s of r.steps) s.templates = [];
  } else if (input.inventory?.kind === 'authorized' && classification !== 'authorized_noncompliant' && classification !== 'unrelated') {
    r.warnings.unshift({
      id: 'inventory-authorized',
      level: 'danger',
      dismissible: false,
      text: `This domain is on your authorized third-party list${input.inventory.party ? ` (${input.inventory.party})` : ''}. Consider "Authorized but noncompliant" instead; outbound templates are disabled.`,
    });
    r.allowedTemplates = [];
    for (const s of r.steps) s.templates = [];
  }
  return r;
}

function routeByClass(c: Classification, input: RouteInput): Route {
  const label = CLASSIFICATION_LABELS[c];
  switch (c) {
    case 'phishing_malware': {
      const r = base(c, 'Report to the registrar and the host now');
      const hosts = hostContacts(input);
      r.why.push(
        'Phishing and malware are DNS abuse that registrars must act on under their ICANN agreements, and hosts act on them under their acceptable-use policies.',
        'Abuse desks act fastest on clear evidence: capture screenshots and URLs before reporting, because sites often go down once reported.',
      );
      r.steps.push(
        step('registrar-abuse', 'Report to the registrar', 'The registrar can suspend the domain itself.', [registrarContact(input)], ['registrar-abuse']),
        step('host-abuse', 'Report to the host / network', hosts.some((h) => h.label.includes('CDN')) ? 'A CDN fronts this site. Report to the CDN, which forwards the report to the origin host but will not reveal it.' : 'The host can take the content offline.', hosts, ['host-abuse']),
        step('disclosure', 'Request registrant data if needed', 'Use only if you need the registrant identity for follow-up.', [], ['disclosure-request']),
        step('annex', 'Preserve evidence for escalation', 'Build an evidence annex in case a UDRP or court action follows.', [], ['udrp-annex']),
      );
      r.warnings.push({ id: 'urgent', level: 'danger', dismissible: false, text: 'Urgent: active phishing or malware harms users now. Capture evidence first, then report the same day.' });
      r.escalations = escalations(input.domain);
      return r;
    }
    case 'copied_content': {
      const r = base(c, 'DMCA notice to the host (copyright only)');
      r.why.push('Copied site content is a copyright issue. The DMCA notice-and-takedown process in 17 U.S.C. § 512(c) asks the host to remove it.');
      r.steps.push(
        step('dmca', 'Send a DMCA notice to the host’s designated agent', 'Check the US Copyright Office DMCA designated agent directory for the host’s agent.', hostContacts(input), ['dmca-notice']),
        step('host-abuse', 'Optionally notify the host’s abuse desk', 'Useful when the copy is also deceptive.', hostContacts(input), ['host-abuse']),
      );
      r.warnings.push(
        { id: 'dmca-copyright-only', level: 'danger', dismissible: false, text: DMCA_COPYRIGHT_ONLY },
        { id: 'dmca-512f', level: 'caution', dismissible: false, text: 'Knowingly and materially misrepresenting infringement creates liability under 17 U.S.C. § 512(f). Consider fair use before sending (Lenz v. Universal Music Corp., 815 F.3d 1145 (9th Cir. 2016)).' },
      );
      r.requiresAck = {
        id: 'dmca-fair-use-considered',
        text: 'I confirm that the copied material is a copyrighted work we own or are authorized to enforce, and that we have considered whether the use is fair use.',
      };
      r.escalations = escalations(input.domain).filter((e) => e.id === 'acpa' || e.id === 'udrp');
      return r;
    }
    case 'cybersquatting': {
      const r = base(c, 'Demand letter to the registrant; UDRP / URS / ACPA as escalation');
      r.why.push(
        'With no content there is nothing for a host to remove, so the remedy runs against the registration itself.',
        'Registrant data is usually redacted. Ask for disclosure through ICANN RDRS or directly from the registrar (Registration Data Policy §10).',
      );
      r.steps.push(
        step('disclosure', 'Get the registrant’s identity', 'RDRS covers participating gTLD registrars only. Otherwise use the registrar’s own §10 disclosure process.', [registrarContact(input)], ['disclosure-request']),
        step('demand', 'Send a demand letter', 'All legal assertions are placeholders for counsel to complete.', [], ['demand-letter']),
        step('annex', 'Prepare the evidence annex', 'Organized by the three UDRP ¶4(a) elements.', [], ['udrp-annex']),
      );
      const w = rdnhWarning(input);
      if (w) r.warnings.push(w);
      r.escalations = escalations(input.domain);
      return r;
    }
    case 'parked_ads': {
      const r = base(c, 'Trademark complaint to the parking provider, then a demand letter');
      const park = parkingContact(input);
      r.why.push(
        'Parking providers often remove ads that trade on a mark when they get a trademark complaint. It is fast and cheap.',
        'PPC links on a confusingly similar domain are commonly cited as bad-faith evidence under the UDRP (WIPO Overview 3.0 §2.9, §3.5).',
      );
      r.steps.push(
        step('parking-complaint', 'File a trademark complaint with the parking provider', park ? 'Use the provider’s IP / trademark complaint process.' : 'No known parking provider matched the nameservers. Identify it from the page itself.', park ? [park] : [], []),
        step('disclosure', 'Get the registrant’s identity', 'Via RDRS or the registrar’s §10 process.', [registrarContact(input)], ['disclosure-request']),
        step('demand', 'Send a demand letter', 'All legal assertions are placeholders for counsel to complete.', [], ['demand-letter']),
        step('annex', 'Prepare the evidence annex', 'Capture the parked page with its ads first.', [], ['udrp-annex']),
      );
      const w = rdnhWarning(input);
      if (w) r.warnings.push(w);
      r.escalations = escalations(input.domain);
      return r;
    }
    case 'for_sale': {
      const r = base(c, 'Capture evidence, then decide: buy or UDRP');
      r.why.push(
        'An offer to sell to the mark owner for more than out-of-pocket costs is listed bad-faith evidence under UDRP ¶4(b)(i) (WIPO Overview 3.0 §3.1.1).',
        'Buying through a broker may cost less than a UDRP; that is a business decision.',
      );
      r.steps.push(
        step('evidence', 'Capture the sale listing and asking price', 'Screenshot the listing, marketplace page and any price before contacting anyone.', [], ['udrp-annex']),
        step('decide', 'Decide: anonymous purchase via a broker, or UDRP', 'Compare the asking price with UDRP provider fees and counsel costs.', [], []),
        step('disclosure', 'Get the registrant’s identity if pursuing UDRP', 'Via RDRS or the registrar’s §10 process.', [registrarContact(input)], ['disclosure-request']),
        step('demand', 'Demand letter (use with caution)', 'See the caution below before contacting the registrant.', [], ['demand-letter']),
      );
      r.warnings.push({
        id: 'for-sale-contact',
        level: 'caution',
        dismissible: true,
        text: 'Contacting the registrant can raise the price, and a demand that reads as an inquiry can look like a negotiation. Consult counsel before any contact.',
      });
      const w = rdnhWarning(input);
      if (w) r.warnings.push(w);
      r.escalations = escalations(input.domain);
      return r;
    }
    case 'fair_use': {
      const r = base(c, 'Consult counsel before any contact');
      r.why.push(
        'Noncommercial criticism and commentary sites are often protected. See Lamparello v. Falwell, 420 F.3d 309 (4th Cir. 2005); Bosley Medical Institute v. Kremer, 403 F.3d 672 (9th Cir. 2005); Taubman Co. v. Webfeats, 319 F.3d 770 (6th Cir. 2003).',
        'Under the UDRP, legitimate noncommercial or fair use is a defense (¶4(c)(iii); WIPO Overview 3.0 §2.6 for criticism sites, §2.7 for fan sites).',
        'A threat letter can backfire: declaratory-judgment or anti-SLAPP exposure, and publicity that amplifies the criticism.',
      );
      r.steps.push(
        step('counsel', 'Review with counsel', 'Outbound templates stay locked until you record that counsel was consulted.', [], []),
        step('annex', 'Preserve evidence (internal)', 'An internal record only.', [], ['udrp-annex']),
        step('disclosure', 'Disclosure request (after counsel review)', 'Only if counsel decides to proceed.', [registrarContact(input)], ['disclosure-request']),
        step('demand', 'Demand letter (after counsel review)', 'Only if counsel decides to proceed.', [], ['demand-letter']),
      );
      r.warnings.push({ id: 'fair-use', level: 'danger', dismissible: false, text: 'Possible fair use or criticism. Do not contact the registrant, host or registrar until counsel has reviewed it.' });
      r.requiresAck = { id: 'counsel-consulted', text: 'Counsel has reviewed this domain and approved proceeding with outreach.' };
      r.escalations = escalations(input.domain);
      return r;
    }
    case 'authorized_noncompliant': {
      const r = base(c, 'Internal compliance note to the relationship owner');
      r.why.push('This is a partner or licensee. Fix it through the relationship and the contract, not with a legal threat.');
      r.steps.push(step('compliance', 'Write an internal compliance note', 'Neutral internal note describing what is out of compliance.', [], ['compliance-note']));
      r.warnings.push({ id: 'no-threats', level: 'info', dismissible: false, text: 'Authorized parties never receive demand letters, DMCA notices, abuse reports or UDRP threats from this tool.' });
      return r;
    }
    case 'unrelated': {
      const r = base(c, 'No action');
      r.why.push(`Classified as "${label}". The reason is recorded in the audit log.`);
      r.steps.push(step('record', 'Record why it is unrelated', 'Add a note to the classification so the decision is documented.', [], []));
      return r;
    }
  }
}

/** Templates usable right now: the route's set, minus everything outbound while an acknowledgment is pending. */
export function effectiveTemplates(route: Route, acks: readonly { id: string }[]): TemplateId[] {
  if (route.requiresAck && !acks.some((a) => a.id === route.requiresAck?.id)) {
    // Internal-only templates stay available while locked.
    return route.allowedTemplates.filter((t) => t === 'udrp-annex' || t === 'compliance-note');
  }
  return route.allowedTemplates;
}
