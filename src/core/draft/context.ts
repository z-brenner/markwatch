// Builds the merge context for one domain: a nested object whose leaves are
// facts Markwatch knows. Facts from lookups are wrapped as Sourced values that
// carry "<where>, <when>" so a draft can footnote them. Nothing here is
// invented: a value that is unknown is simply absent, and the merge engine
// renders it as UNFILLED.
import { CLASSIFICATION_LABELS, type CaseState, type DomainRecord, type LookupResult, type Route } from '../types';
import { nowUtc } from '../util';

export interface Sourced<T> {
  value: T;
  source?: string;
}

/** Nested object; leaves are string | string[] | number | boolean | Sourced (or arrays of Sourced strings). */
export type DraftContext = Record<string, unknown>;

export const CONTEXT_FIELDS: { path: string; description: string }[] = [
  { path: 'today', description: 'Today’s date, YYYY-MM-DD (UTC).' },
  { path: 'domain', description: 'The reported domain, ASCII/punycode form.' },
  { path: 'domainUnicode', description: 'The reported domain, Unicode display form.' },
  { path: 'registrable', description: 'Registrable domain (eTLD+1) of the reported domain.' },
  { path: 'classification.id', description: 'Classification id chosen by the user (e.g. phishing_malware).' },
  { path: 'classification.label', description: 'Human-readable classification chosen by the user.' },
  { path: 'techniques', description: 'Permutation techniques that produced the domain (list).' },
  { path: 'mark.names', description: 'All marks in the case (list).' },
  { path: 'mark.primary', description: 'The first mark in the case.' },
  { path: 'mark.owner', description: 'Mark owner as entered by the user.' },
  { path: 'mark.primaryDomain', description: 'The mark owner’s primary domain.' },
  {
    path: 'mark.rights',
    description: 'Mark rights as entered: "Reg. No. <number> (<jurisdiction>)[, classes <classes>][, first use <firstUse>]" (list). Never looked up or invented.',
  },
  { path: 'sender.name', description: 'Sender name (case settings).' },
  { path: 'sender.title', description: 'Sender title.' },
  { path: 'sender.organization', description: 'Sender organization.' },
  { path: 'sender.email', description: 'Sender email.' },
  { path: 'sender.phone', description: 'Sender phone.' },
  { path: 'sender.address', description: 'Sender postal address.' },
  { path: 'registrar.name', description: 'Sponsoring registrar (RDAP).' },
  { path: 'registrar.ianaId', description: 'Registrar IANA ID (RDAP).' },
  { path: 'registrar.abuseEmail', description: 'Registrar abuse email(s) (RDAP abuse role; list).' },
  { path: 'registrar.abuseTel', description: 'Registrar abuse phone(s) (RDAP abuse role; list).' },
  { path: 'registry.server', description: 'RDAP server that answered for the domain.' },
  { path: 'registration.created', description: 'Registration date (RDAP).' },
  { path: 'registration.expires', description: 'Expiration date (RDAP).' },
  { path: 'registration.status', description: 'EPP status values (RDAP; list).' },
  { path: 'registrant.name', description: 'Registrant name if not redacted (RDAP).' },
  { path: 'registrant.org', description: 'Registrant organization if not redacted (RDAP).' },
  { path: 'registrant.email', description: 'Registrant email(s) if not redacted (RDAP; list).' },
  { path: 'registrant.country', description: 'Registrant country if published (RDAP).' },
  { path: 'registrant.redacted', description: '"yes" when RDAP marks registrant data as redacted, otherwise "no".' },
  { path: 'host.ips', description: 'IPv4 and IPv6 addresses the domain resolves to (DNS; list).' },
  { path: 'host.networkOrg', description: 'Organisation(s) holding those IP networks (IP RDAP; list).' },
  { path: 'host.networkName', description: 'Network name(s) (IP RDAP; list).' },
  {
    path: 'host.abuseEmail',
    description: 'Hosting abuse email(s): union of IP RDAP abuse contacts and the Abusix Contact DB (credited in the source line; list).',
  },
  { path: 'cdn.name', description: 'CDN / reverse proxy in front of the site, if inferred.' },
  { path: 'cdn.abuseUrl', description: 'The CDN’s abuse reporting URL, if known.' },
  { path: 'dns.ns', description: 'Nameservers (DNS; list).' },
  { path: 'dns.mx', description: 'Mail exchangers (DNS; list).' },
  { path: 'dns.a', description: 'IPv4 addresses (DNS; list).' },
  { path: 'dns.aaaa', description: 'IPv6 addresses (DNS; list).' },
  { path: 'parking.name', description: 'Parking provider, if inferred from nameservers.' },
  { path: 'parking.complaintUrl', description: 'The parking provider’s trademark complaint URL, if known.' },
  { path: 'ct.latestNotBefore', description: 'Most recent certificate notBefore seen in CT logs.' },
  { path: 'ct.count', description: 'Number of CT log certificates seen (only when the CT lookup succeeded).' },
  { path: 'evidence.list', description: 'Evidence linked to this domain: "<name> — SHA-256 <sha256>" (list).' },
  { path: 'score.total', description: 'Markwatch heuristic score (ranking only; not a finding).' },
  { path: 'inventory.party', description: 'Authorized party, when the domain matches an "authorized" inventory entry.' },
  { path: 'inventory.pattern', description: 'Inventory pattern the domain matched, if any.' },
  { path: 'urs.eligible', description: 'Whether the URS may apply, from the TLD: "yes …", "yes (verify) …" or "no — …".' },
  { path: 'followUp.ack', description: 'Registration Data Policy §10.5 acknowledgment due date: today + 2 business days (weekends skipped, holidays not).' },
  { path: 'followUp.response', description: 'Registration Data Policy §10.5 response due date: followUp.ack + 30 calendar days.' },
];

/** Legacy gTLDs that are not covered by the URS. */
const NON_URS_LEGACY = new Set(['com', 'net', 'edu', 'gov', 'mil', 'int', 'arpa']);
/** Legacy gTLDs that adopted the URS in their 2019 registry agreement renewals. */
const URS_LEGACY = new Set(['org', 'info', 'biz']);

export function ursEligibility(domain: string): string {
  const tld = (domain.toLowerCase().replace(/\.$/, '').split('.').pop() ?? '').trim();
  if (tld === '') return 'no — no TLD';
  if (NON_URS_LEGACY.has(tld)) return `no — .${tld} is a legacy gTLD not covered by the URS`;
  if (/^[a-z]{2}$/.test(tld)) return `no — ccTLD (.${tld}); check the ccTLD’s own dispute policy`;
  if (URS_LEGACY.has(tld)) return `yes — .${tld} adopted the URS in its 2019 registry agreement renewal`;
  if (tld.startsWith('xn--')) {
    return `yes (verify) — .${tld} is an internationalized TLD; the URS does not apply if it is an IDN ccTLD`;
  }
  return `yes (verify) — .${tld} appears to be a post-2012 gTLD; confirm URS coverage`;
}

/** Adds n business days (Mon–Fri) to a UTC date. Public holidays are not considered. */
export function addBusinessDays(date: Date, n: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function addCalendarDays(date: Date, n: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lookup data is untrusted: collapse control characters (incl. line breaks) so a fact stays on one line. */
function clean(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, ' ').trim();
}

function cleanList(xs: readonly (string | undefined)[] | undefined): string[] {
  const out: string[] = [];
  for (const x of xs ?? []) {
    const c = clean(x);
    if (c !== '' && !out.includes(c)) out.push(c);
  }
  return out;
}

const KIND_LABEL: Record<LookupResult<unknown>['kind'], string> = {
  dns: 'DNS',
  'rdap-domain': 'RDAP',
  'rdap-ip': 'RDAP',
  ct: 'CT',
  abuse: 'Abusix Contact DB',
};

/** "<label> <LookupResult.source>, <at>", marking user-pasted data as such. */
export function describeLookup(l: LookupResult<unknown>): string {
  const src = clean(l.source);
  const label = KIND_LABEL[l.kind];
  let where: string;
  if (l.kind === 'abuse') where = src === '' ? label : `${label} (${src})`;
  else where = src === '' ? label : src.toLowerCase().startsWith(`${label.toLowerCase()} `) ? src : `${label} ${src}`;
  if (l.status === 'manual') where += ' (pasted manually by the user)';
  return `${where}, ${clean(l.at)}`;
}

function usable(l: LookupResult<unknown>): boolean {
  return l.status === 'ok' || l.status === 'manual';
}

/** The most recent usable lookup of a kind that satisfies a predicate. */
function latest(lookups: LookupResult<unknown>[], kind: LookupResult<unknown>['kind'], pred: (l: LookupResult<unknown>) => boolean = () => true): LookupResult<unknown> | undefined {
  let best: LookupResult<unknown> | undefined;
  for (const l of lookups) {
    if (l.kind !== kind || !usable(l) || !pred(l)) continue;
    if (!best || l.at >= best.at) best = l;
  }
  return best;
}

function queryHead(l: LookupResult<unknown>): string {
  return (l.query.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/\.$/, '');
}

function reverseIpv4(ip: string): string | undefined {
  const parts = ip.split('.');
  return parts.length === 4 ? parts.reverse().join('.') : undefined;
}

function sourced<T>(value: T, source: string | undefined): Sourced<T> | T {
  return source ? { value, source } : value;
}

export function buildDraftContext(state: CaseState, domain: DomainRecord, opts: { now?: Date; route?: Route } = {}): DraftContext {
  const now = opts.now ?? new Date(nowUtc());
  const today = ymd(now);
  const ack = addBusinessDays(now, 2);
  const facts = domain.facts;
  const rdap = facts?.rdap;
  const lookups = domain.lookups;
  const names = new Set([domain.domain.toLowerCase(), domain.registrable.toLowerCase()]);

  const rdapLookup = rdap ? latest(lookups, 'rdap-domain', (l) => names.has(queryHead(l))) ?? latest(lookups, 'rdap-domain') : undefined;
  const rdapSource = rdapLookup ? describeLookup(rdapLookup) : rdap?.server ? `RDAP ${clean(rdap.server)}` : undefined;

  const dnsSource = (type: string): string | undefined => {
    const l = latest(lookups, 'dns', (x) => {
      const parts = x.query.trim().split(/\s+/);
      return names.has(queryHead(x)) && (parts[1] ?? '').toUpperCase() === type;
    });
    return l ? describeLookup(l) : undefined;
  };

  const ctx: DraftContext = {};
  const set = (path: string, value: unknown): void => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (isSourcedValue(value)) {
      const v = value.value;
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return;
    }
    const segs = path.split('.');
    let node = ctx;
    for (const seg of segs.slice(0, -1)) {
      const next = node[seg];
      if (next && typeof next === 'object' && !Array.isArray(next)) node = next as DraftContext;
      else {
        const created: DraftContext = {};
        node[seg] = created;
        node = created;
      }
    }
    node[segs[segs.length - 1] ?? path] = value;
  };

  set('today', today);
  set('domain', clean(domain.domain));
  set('domainUnicode', clean(domain.unicode));
  set('registrable', clean(domain.registrable));

  const cls = domain.classification?.value ?? opts.route?.classification;
  if (cls) {
    set('classification.id', cls);
    set('classification.label', CLASSIFICATION_LABELS[cls]);
  }
  set('techniques', [...domain.techniques]);

  // Mark and sender: user-entered case data, used exactly as entered.
  const marks = cleanList(state.subject.marks);
  set('mark.names', marks);
  set('mark.primary', marks[0]);
  set('mark.owner', clean(state.subject.owner));
  set('mark.primaryDomain', clean(state.subject.primaryDomain));
  set('mark.rights', formatRights(state.subject.rights));
  for (const k of ['name', 'title', 'organization', 'email', 'phone'] as const) set(`sender.${k}`, clean(state.sender[k]));
  // The postal address may legitimately span lines; keep line breaks but drop other control characters.
  set(
    'sender.address',
    // eslint-disable-next-line no-control-regex
    (state.sender.address ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim(),
  );

  // Registration data (RDAP).
  if (rdap) {
    const reg = rdap.registrar;
    set('registrar.name', sourced(clean(reg?.name), rdapSource));
    set('registrar.ianaId', sourced(clean(reg?.ianaId), rdapSource));
    set('registrar.abuseEmail', sourced(cleanList(reg?.abuseEmail), rdapSource));
    set('registrar.abuseTel', sourced(cleanList(reg?.abuseTel), rdapSource));
    set('registry.server', sourced(clean(rdap.server), rdapSource));
    set('registration.created', sourced(clean(rdap.registered), rdapSource));
    set('registration.expires', sourced(clean(rdap.expires), rdapSource));
    set('registration.status', sourced(cleanList(rdap.status), rdapSource));
    const rt = rdap.registrant;
    const redacted = Boolean(rt?.redacted) || rdap.redactedFields.some((f) => /registrant/i.test(f));
    if (rt && !rt.redacted) {
      set('registrant.name', sourced(clean(rt.name), rdapSource));
      set('registrant.org', sourced(clean(rt.org), rdapSource));
      set('registrant.email', sourced(cleanList(rt.email), rdapSource));
    }
    if (rt) set('registrant.country', sourced(clean(rt.country), rdapSource));
    // Absent registrant data with no redaction marker is "unknown", not "not redacted".
    if (rt || redacted) set('registrant.redacted', sourced(redacted ? 'yes' : 'no', rdapSource));
  }

  // DNS.
  if (facts) {
    const nsSrc = dnsSource('NS');
    const aSrc = dnsSource('A');
    const aaaaSrc = dnsSource('AAAA');
    const mxSrc = dnsSource('MX');
    set('dns.ns', sourced(cleanList(facts.ns), nsSrc));
    set('dns.mx', sourced(cleanList(facts.mx), mxSrc));
    set('dns.a', sourced(cleanList(facts.a), aSrc));
    set('dns.aaaa', sourced(cleanList(facts.aaaa), aaaaSrc));

    // Hosting: IPs, network owners, abuse contacts.
    const ips = [...cleanList(facts.a).map((ip) => sourced(ip, aSrc)), ...cleanList(facts.aaaa).map((ip) => sourced(ip, aaaaSrc))];
    set('host.ips', ips);

    const orgs: (string | Sourced<string>)[] = [];
    const netNames: (string | Sourced<string>)[] = [];
    const abuse = new Map<string, string[]>();
    const addAbuse = (email: string, source: string | undefined): void => {
      const list = abuse.get(email) ?? [];
      if (source && !list.includes(source)) list.push(source);
      abuse.set(email, list);
    };
    const ipList = uniqStrings([...Object.keys(facts.networks), ...Object.keys(facts.abusix)]);
    for (const ip of ipList) {
      const net = facts.networks[ip];
      if (net) {
        const l = latest(lookups, 'rdap-ip', (x) => queryHead(x) === ip.toLowerCase());
        const src = l ? describeLookup(l) : net.server ? `RDAP ${clean(net.server)}` : undefined;
        const org = clean(net.org);
        if (org && !orgs.some((o) => valueOf(o) === org)) orgs.push(sourced(org, src));
        const nm = clean(net.name);
        if (nm && !netNames.some((o) => valueOf(o) === nm)) netNames.push(sourced(nm, src));
        for (const e of cleanList(net.abuseEmail)) addAbuse(e, src);
      }
      if (state.settings.useAbusix) {
        const rev = reverseIpv4(ip);
        const l = latest(lookups, 'abuse', (x) => {
          const head = queryHead(x);
          return head === ip.toLowerCase() || (rev !== undefined && head.startsWith(`${rev}.`));
        });
        const src = l ? describeLookup(l) : 'Abusix Contact DB';
        for (const e of cleanList(facts.abusix[ip])) addAbuse(e, src);
      }
    }
    set('host.networkOrg', orgs);
    set('host.networkName', netNames);
    set(
      'host.abuseEmail',
      [...abuse.entries()].map(([email, srcs]) => sourced(email, srcs.length ? srcs.join('; ') : undefined)),
    );

    // Providers (inferred by Markwatch from DNS/RDAP patterns, not looked up directly).
    const cdn = facts.providers.find((p) => p.role === 'cdn') ?? facts.providers.find((p) => p.hidesOrigin);
    if (cdn) {
      const src = `Markwatch provider inference (${clean(cdn.evidence)})`;
      set('cdn.name', sourced(clean(cdn.name), src));
      set('cdn.abuseUrl', sourced(clean(cdn.abuseUrl), src));
    }
    const parking = facts.providers.find((p) => p.role === 'parking');
    if (parking) {
      const src = `Markwatch provider inference (${clean(parking.evidence)})`;
      set('parking.name', sourced(clean(parking.name), src));
      set('parking.complaintUrl', sourced(clean(parking.trademarkComplaintUrl), src));
    }

    // Certificate Transparency. A count is reported only when a CT lookup succeeded:
    // a blocked lookup must never read as "0 certificates".
    const ctLookup = latest(lookups, 'ct');
    const ctSrc = ctLookup ? describeLookup(ctLookup) : undefined;
    if (facts.ct.length > 0) {
      const latestNb = facts.ct.reduce((m, c) => (c.notBefore > m ? c.notBefore : m), '');
      set('ct.latestNotBefore', sourced(clean(latestNb), ctSrc));
    }
    if (ctLookup || facts.ct.length > 0) set('ct.count', sourced(facts.ct.length, ctSrc));
  }

  // Evidence linked to this domain.
  const linked = new Set(domain.evidence);
  const evidence = state.evidence
    .filter((e) => linked.has(e.sha256) || e.domains.some((d) => names.has(d.toLowerCase())))
    .map((e) => `${clean(e.name)} — SHA-256 ${clean(e.sha256)}`);
  set('evidence.list', uniqStrings(evidence));

  if (domain.score) set('score.total', domain.score.total);
  if (domain.inventory) {
    set('inventory.party', clean(domain.inventory.party));
    set('inventory.pattern', clean(domain.inventory.pattern));
  }

  set('urs.eligible', ursEligibility(domain.registrable || domain.domain));
  set('followUp.ack', ymd(ack));
  set('followUp.response', ymd(addCalendarDays(ack, 30)));
  return ctx;
}

/** "Reg. No. <number> (<jurisdiction>)[, classes <classes>][, first use <firstUse>]", exactly as entered. */
export function formatRights(rights: CaseState['subject']['rights']): string[] {
  const out: string[] = [];
  for (const r of rights) {
    const number = clean(r.number);
    if (number === '') continue; // nothing to cite; never invent one
    const jur = clean(r.jurisdiction);
    let s = `Reg. No. ${number}${jur ? ` (${jur})` : ''}`;
    const classes = clean(r.classes);
    if (classes) s += `, classes ${classes}`;
    const firstUse = clean(r.firstUse);
    if (firstUse) s += `, first use ${firstUse}`;
    out.push(s);
  }
  return out;
}

export function isSourcedValue(v: unknown): v is Sourced<unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!Object.prototype.hasOwnProperty.call(v, 'value')) return false;
  const rec = v as Record<string, unknown>;
  return Object.keys(rec).every((k) => k === 'value' || k === 'source') && (rec.source === undefined || typeof rec.source === 'string');
}

function valueOf(v: unknown): unknown {
  return isSourcedValue(v) ? v.value : v;
}

function uniqStrings(xs: string[]): string[] {
  return [...new Set(xs)];
}
