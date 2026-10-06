// RDAP response parsing (RFC 9083, RFC 9537 redaction, ICANN gTLD RDAP
// Response Profile v2.2). Input is untrusted JSON: shapes are checked by hand,
// arrays and strings are capped, and nothing here throws.
//
// Notes from captured responses (tests/fixtures/rdap):
//  - Status values use the RDAP spelling ("client hold"), not EPP ("clientHold").
//  - Event dates come with fractions (".009091Z") or offsets ("-04:00", ARIN);
//    all are normalized to ISO UTC with "Z".
//  - Since the 2025 Registration Data Policy most gTLD registries return no
//    registrant entity at all; Nominet returns one with an emptied name and a
//    placeholder email, plus an RFC 9537 "redacted" array.
//  - Verisign answers 404 with an empty body.
import type { RdapContact, RdapDomain, RdapNetwork, RdapRegistrar } from '../types';
import { uniq } from '../util';
import { asArray, cleanText, isRecord, normalizeHost, toIsoUtc } from '../net/clean';
import { isIPv4, isIPv6 } from '../net/ip';
import { parseVcard, type VcardSummary } from './vcard';

const MAX_ENTITIES = 100;
const MAX_DEPTH = 4;

/**
 * Values that registries and privacy services put in place of real contact
 * data. Matching any of them marks the contact as redacted and the value is
 * dropped. Deliberately excludes a bare "private", which real company names use.
 */
export const REDACTION_MARKERS =
  /redacted|data protected|privacy|not disclosed|non-public|withheld|statutory masking|gdpr|domains by proxy|whoisguard|identity protect|contact the registrar|query the rdds/i;

export function looksRedacted(value: string): boolean {
  return REDACTION_MARKERS.test(value);
}

function roles(e: Record<string, unknown>): string[] {
  return asArray(e.roles, 20)
    .filter((r): r is string => typeof r === 'string')
    .map((r) => r.trim().toLowerCase());
}

function entitiesOf(obj: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(obj.entities, MAX_ENTITIES).filter(isRecord);
}

/** Depth-first walk over an object's entities and their nested entities. */
function walkEntities(obj: Record<string, unknown>, visit: (e: Record<string, unknown>) => void, depth = 0): void {
  if (depth >= MAX_DEPTH) return;
  for (const e of entitiesOf(obj)) {
    visit(e);
    walkEntities(e, visit, depth + 1);
  }
}

function strings(v: unknown, max = 50, len = 200): string[] {
  return uniq(
    asArray(v, max)
      .map((x) => cleanText(x, len))
      .filter((x): x is string => !!x),
  );
}

interface Events {
  registered?: string;
  expires?: string;
  lastChanged?: string;
}

function parseEvents(v: unknown): Events {
  const out: Events = {};
  for (const ev of asArray(v, 50)) {
    if (!isRecord(ev) || typeof ev.eventAction !== 'string') continue;
    const date = toIsoUtc(ev.eventDate);
    if (!date) continue;
    const action = ev.eventAction.trim().toLowerCase();
    if (action === 'registration') out.registered ??= date;
    else if (action === 'expiration') out.expires ??= date;
    else if (action === 'last changed') out.lastChanged ??= date;
  }
  return out;
}

/**
 * A web page link with the given rel. Links typed as JSON are skipped: the
 * registrar's "about" link is often its RDAP base URL, not its website.
 */
function webLink(obj: Record<string, unknown>, rel: string): string | undefined {
  let fallback: string | undefined;
  for (const l of asArray(obj.links, 50)) {
    if (!isRecord(l) || l.rel !== rel) continue;
    const href = cleanText(l.href, 2000);
    if (!href || !/^https?:\/\/\S+$/i.test(href)) continue;
    const type = typeof l.type === 'string' ? l.type.toLowerCase() : '';
    if (type.startsWith('text/html')) return href;
    if (!type.includes('json')) fallback ??= href;
  }
  return fallback;
}

/** "Registrar Name" from fn, falling back to org; empty strings are common and skipped. */
function displayName(v: VcardSummary): string | undefined {
  return v.fn ?? v.org;
}

function parseRegistrar(e: Record<string, unknown>): RdapRegistrar {
  const v = parseVcard(e.vcardArray);
  const reg: RdapRegistrar = { abuseEmail: [], abuseTel: [] };
  const name = displayName(v);
  if (name) reg.name = name;
  for (const id of asArray(e.publicIds, 20)) {
    if (!isRecord(id) || typeof id.type !== 'string' || id.type.trim().toLowerCase() !== 'iana registrar id') continue;
    const ident = typeof id.identifier === 'number' && Number.isInteger(id.identifier) ? String(id.identifier) : cleanText(id.identifier, 20);
    if (ident && /^\d+$/.test(ident)) {
      reg.ianaId = ident;
      break;
    }
  }
  const url = v.url ?? webLink(e, 'about');
  if (url) reg.url = url;
  // Response Profile v2.2 §2.4.5: the abuse contact is an entity nested in the registrar.
  for (const sub of entitiesOf(e)) {
    if (!roles(sub).includes('abuse')) continue;
    const a = parseVcard(sub.vcardArray);
    reg.abuseEmail = uniq([...reg.abuseEmail, ...a.emails]);
    reg.abuseTel = uniq([...reg.abuseTel, ...a.tels]);
  }
  return reg;
}

interface Redaction {
  fields: string[];
  registrant: boolean;
}

function parseRedacted(v: unknown): Redaction {
  const fields: string[] = [];
  let registrant = false;
  for (const r of asArray(v, 100)) {
    if (!isRecord(r)) continue;
    const name = isRecord(r.name) ? (cleanText(r.name.description, 200) ?? cleanText(r.name.type, 200)) : undefined;
    if (name) fields.push(name);
    const paths = [r.prePath, r.postPath, r.replacementPath].filter((p): p is string => typeof p === 'string').join(' ');
    if ((name && /registrant/i.test(name)) || /registrant/i.test(paths)) registrant = true;
  }
  return { fields: uniq(fields), registrant };
}

function parseContact(e: Record<string, unknown>, redactedByPolicy: boolean): RdapContact {
  const v = parseVcard(e.vcardArray);
  let redacted = redactedByPolicy;
  const keep = (s: string | undefined): string | undefined => {
    if (s && looksRedacted(s)) {
      redacted = true;
      return undefined;
    }
    return s;
  };
  const contact: RdapContact = { roles: roles(e), email: [], tel: [], redacted: false };
  const name = keep(v.fn);
  const org = keep(v.org);
  const country = keep(v.country);
  contact.email = v.emails.filter((x) => keep(x) !== undefined);
  contact.tel = v.tels;
  if (name) contact.name = name;
  if (org) contact.org = org;
  if (country) contact.country = country;
  contact.redacted = redacted;
  return contact;
}

/**
 * Parses an RDAP domain object. Returns null unless the JSON is an object with
 * an ldhName (or unicodeName) and, if it declares objectClassName, it is "domain".
 */
export function parseRdapDomain(json: unknown, server: string): RdapDomain | null {
  if (!isRecord(json)) return null;
  if (json.objectClassName !== undefined && json.objectClassName !== 'domain') return null;
  const ldhName = normalizeHost(json.ldhName) ?? normalizeHost(json.unicodeName);
  if (!ldhName) return null;

  const redaction = parseRedacted(json.redacted);
  const out: RdapDomain = {
    ldhName,
    status: strings(json.status),
    nameservers: [],
    redactedFields: redaction.fields,
    server,
  };
  const unicodeName = cleanText(json.unicodeName, 253);
  if (unicodeName) out.unicodeName = unicodeName.replace(/\.$/, '');
  const handle = cleanText(json.handle, 200);
  if (handle) out.handle = handle;

  const ev = parseEvents(json.events);
  if (ev.registered) out.registered = ev.registered;
  if (ev.expires) out.expires = ev.expires;
  if (ev.lastChanged) out.lastChanged = ev.lastChanged;

  for (const e of entitiesOf(json)) {
    const r = roles(e);
    if (!out.registrar && r.includes('registrar')) out.registrar = parseRegistrar(e);
    if (!out.registrant && r.includes('registrant')) out.registrant = parseContact(e, redaction.registrant);
  }
  if (!out.registrant && redaction.registrant) {
    out.registrant = { roles: ['registrant'], email: [], tel: [], redacted: true };
  }

  out.nameservers = uniq(
    asArray(json.nameservers, 50)
      .map((ns) => (isRecord(ns) ? normalizeHost(ns.ldhName) : undefined))
      .filter((h): h is string => !!h),
  );
  return out;
}

/**
 * True when a READABLE RDAP response says the object does not exist: HTTP 404
 * with any body (Verisign sends none; PIR sends an error object). Only valid
 * for the authoritative registry server from the bootstrap.
 */
export function isRdapNotFound(status: number, _json: unknown): boolean {
  return status === 404;
}

function parseCidrs(v: unknown): string[] {
  const out: string[] = [];
  for (const c of asArray(v, 50)) {
    if (!isRecord(c)) continue;
    const len = c.length;
    if (typeof len !== 'number' || !Number.isInteger(len) || len < 0) continue;
    if (typeof c.v4prefix === 'string' && isIPv4(c.v4prefix) && len <= 32) out.push(`${c.v4prefix}/${len}`);
    else if (typeof c.v6prefix === 'string' && isIPv6(c.v6prefix) && len <= 128) out.push(`${c.v6prefix.toLowerCase()}/${len}`);
  }
  return uniq(out);
}

/**
 * Parses an RDAP IP network object from a regional internet registry.
 * Returns null unless it looks like one (objectClassName "ip network" when
 * declared, and at least a handle, start address or CIDR).
 */
export function parseRdapNetwork(json: unknown, server: string): RdapNetwork | null {
  if (!isRecord(json)) return null;
  if (json.objectClassName !== undefined && json.objectClassName !== 'ip network') return null;
  const handle = cleanText(json.handle, 200);
  const start = cleanText(json.startAddress, 45);
  const end = cleanText(json.endAddress, 45);
  const cidr = parseCidrs(json.cidr0_cidrs);
  const startAddress = start && (isIPv4(start) || isIPv6(start)) ? start.toLowerCase() : undefined;
  const endAddress = end && (isIPv4(end) || isIPv6(end)) ? end.toLowerCase() : undefined;
  if (!handle && !startAddress && cidr.length === 0) return null;

  const out: RdapNetwork = { cidr, abuseEmail: [], server };
  if (handle) out.handle = handle;
  const name = cleanText(json.name, 200);
  if (name) out.name = name;
  if (startAddress) out.startAddress = startAddress;
  if (endAddress) out.endAddress = endAddress;
  const country = cleanText(json.country, 10);

  // Holder: a registrant entity, preferring kind "org" (RIPE also lists the
  // maintainer object as a registrant, with kind "individual").
  const registrants = entitiesOf(json)
    .filter((e) => roles(e).includes('registrant'))
    .map((e) => parseVcard(e.vcardArray));
  const holder = registrants.find((v) => v.kind === 'org') ?? registrants[0];
  if (holder) {
    // For an org-kind entity fn is the organisation's name; RIPE's "org"
    // property holds an object handle (ORG-…), not a name.
    const org = holder.kind === 'org' ? (holder.fn ?? holder.org) : (holder.org ?? holder.fn);
    if (org) out.org = org;
  }
  out.org ??= out.name;
  if (country && /^[a-z]{2}$/i.test(country)) out.country = country.toUpperCase();
  else if (holder?.country && /^[A-Z]{2}$/.test(holder.country)) out.country = holder.country;

  const abuse: string[] = [];
  walkEntities(json, (e) => {
    if (roles(e).includes('abuse')) abuse.push(...parseVcard(e.vcardArray).emails);
  });
  out.abuseEmail = uniq(abuse);
  return out;
}
