// Parsers for text the user pastes when a lookup is blocked (PLAN §2.5):
// WHOIS output, RDAP JSON and dig-style DNS output. Best effort: unknown lines
// are ignored, nothing throws, and the caller labels the result "manual".
import { RR_CODES, type DnsAnswer, type DnsRecord, type RdapContact, type RdapDomain, type RdapRegistrar, type RRType } from '../types';
import { uniq } from '../util';
import { cleanText, isRecord, normalizeEmail, normalizeHost, toIsoUtc } from '../net/clean';
import { isIPv4, isIPv6 } from '../net/ip';
import { looksRedacted, parseRdapDomain } from '../rdap/parse';
import { EXTRA_RR_CODES, normalizeRecordData, parseDohJson, rrTypeOf } from '../dns/doh';

/** Pasted text beyond this is ignored. */
export const MAX_PASTE = 2 * 1024 * 1024;
const MAX_LINES = 20_000;

export type ParsedWhois = Partial<RdapDomain> & { registrarAbuseEmail?: string[] };

function lines(text: string): string[] {
  if (typeof text !== 'string') return [];
  return text.slice(0, MAX_PASTE).split(/\r\n|\r|\n/, MAX_LINES);
}

// ───────────────────────────── WHOIS ─────────────────────────────

const MONTHS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number | string): string => String(n).padStart(2, '0');

/**
 * WHOIS dates come in many shapes: ISO 8601 (with or without zone), "YYYY.MM.DD",
 * "YYYY/MM/DD", "DD-Mon-YYYY" (Nominet), "DD.MM.YYYY". Zone-less values are
 * taken as UTC. Returns ISO UTC with "Z" or undefined.
 */
export function parseWhoisDate(value: string): string | undefined {
  const s = value
    .trim()
    .replace(/\s*\((?:utc|gmt)\)$/i, '')
    .replace(/\s+(?:utc|gmt)$/i, '');
  const iso = toIsoUtc(s);
  if (iso) return iso;
  let m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (m) return toIsoUtc(`${m[1]}-${pad(m[2] ?? '')}-${pad(m[3] ?? '')}${m[4] ? `T${m[4]}` : ''}`);
  m = /^(\d{1,2})[- ]([a-z]{3})[a-z]*[- ](\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/i.exec(s);
  if (m) {
    const mon = MONTHS[(m[2] ?? '').toLowerCase()];
    if (mon) return toIsoUtc(`${m[3]}-${pad(mon)}-${pad(m[1] ?? '')}${m[4] ? `T${m[4]}` : ''}`);
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (m) return toIsoUtc(`${m[3]}-${pad(m[2] ?? '')}-${pad(m[1] ?? '')}${m[4] ? `T${m[4]}` : ''}`);
  return undefined;
}

const KEYS = {
  domain: ['domain name', 'domain', 'domainname'],
  registrar: ['registrar', 'registrar name', 'sponsoring registrar', 'registrar organization'],
  ianaId: ['registrar iana id', 'sponsoring registrar iana id'],
  registrarUrl: ['registrar url'],
  abuseEmail: ['registrar abuse contact email', 'registrar abuse email'],
  abuseTel: ['registrar abuse contact phone', 'registrar abuse phone'],
  created: ['creation date', 'created', 'created on', 'created date', 'registered on', 'registered', 'registration date', 'registration time', 'domain registration date', 'record created'],
  expires: ['registry expiry date', 'registrar registration expiration date', 'expiry date', 'expiration date', 'expires', 'expires on', 'expire date', 'paid-till', 'expiration time', 'domain expiration date'],
  changed: ['updated date', 'last updated', 'changed', 'last modified', 'last-update', 'last update', 'modified'],
  status: ['domain status', 'status'],
  ns: ['name server', 'name servers', 'nameserver', 'nameservers', 'nserver'],
  registrantName: ['registrant name', 'registrant'],
  registrantOrg: ['registrant organization', 'registrant organisation'],
  registrantCountry: ['registrant country', 'registrant country code'],
  registrantEmail: ['registrant email'],
  registrantPhone: ['registrant phone'],
} as const;
type Field = keyof typeof KEYS;

const FIELD_BY_KEY = new Map<string, Field>();
for (const [field, keys] of Object.entries(KEYS) as [Field, readonly string[]][]) for (const k of keys) FIELD_BY_KEY.set(k, field);

/** Sub-keys inside a block such as EURid's "Registrar:\n  Name: …". */
const BLOCK_SUBFIELDS: Readonly<Record<string, Readonly<Record<string, Field>>>> = {
  registrar: { name: 'registrar', organisation: 'registrar', organization: 'registrar', website: 'registrarUrl', url: 'registrarUrl' },
  registrant: { name: 'registrantName', organisation: 'registrantOrg', organization: 'registrantOrg', country: 'registrantCountry', email: 'registrantEmail', phone: 'registrantPhone' },
};

function normKey(k: string): string {
  return k.trim().toLowerCase().replace(/\.+$/, '').replace(/\s+/g, ' ');
}

// "Key: value", where the key is short and is not the scheme of a URL.
const KV = /^\s*([^:/]{1,60}?)\s*:(?!\/\/)\s*(.*)$/;

class WhoisBuilder {
  ldhName?: string;
  status: string[] = [];
  ns: string[] = [];
  registered?: string;
  expires?: string;
  lastChanged?: string;
  registrar: Partial<RdapRegistrar> & { abuseEmail: string[]; abuseTel: string[] } = { abuseEmail: [], abuseTel: [] };
  registrant: Partial<RdapContact> & { email: string[]; tel: string[] } = { email: [], tel: [] };
  registrantSeen = false;
  registrantRedacted = false;

  set(field: Field, raw: string): void {
    const value = cleanText(raw, 500);
    if (!value) return;
    switch (field) {
      case 'domain': {
        const h = normalizeHost(value.split(/\s+/)[0]);
        if (h && !this.ldhName) this.ldhName = h;
        break;
      }
      case 'registrar':
        this.registrar.name ??= value.replace(/\s*\[tag\s*=\s*[^\]]*\]\s*$/i, '');
        break;
      case 'ianaId':
        if (/^\d{1,10}$/.test(value)) this.registrar.ianaId ??= value;
        break;
      case 'registrarUrl':
        if (/^https?:\/\/\S+$/i.test(value)) this.registrar.url ??= value;
        else if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value)) this.registrar.url ??= `https://${value}`;
        break;
      case 'abuseEmail': {
        const e = normalizeEmail(value);
        if (e) this.registrar.abuseEmail = uniq([...this.registrar.abuseEmail, e]);
        break;
      }
      case 'abuseTel':
        if (/\d/.test(value)) this.registrar.abuseTel = uniq([...this.registrar.abuseTel, value]);
        break;
      case 'created':
        this.registered ??= parseWhoisDate(value);
        break;
      case 'expires':
        this.expires ??= parseWhoisDate(value);
        break;
      case 'changed':
        this.lastChanged ??= parseWhoisDate(value);
        break;
      case 'status': {
        // "clientTransferProhibited https://icann.org/epp#clientTransferProhibited"
        const s = value.replace(/\s*\(?https?:\/\/\S*\)?\s*$/i, '').trim();
        if (s) this.status = uniq([...this.status, s]).slice(0, 50);
        break;
      }
      case 'ns': {
        const h = normalizeHost(value.split(/\s+/)[0]);
        if (h && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(h)) this.ns = uniq([...this.ns, h]).slice(0, 50);
        break;
      }
      default:
        this.setRegistrant(field, value);
    }
  }

  private setRegistrant(field: Field, value: string): void {
    this.registrantSeen = true;
    if (looksRedacted(value)) {
      this.registrantRedacted = true;
      return;
    }
    if (field === 'registrantName') this.registrant.name ??= value;
    else if (field === 'registrantOrg') this.registrant.org ??= value;
    else if (field === 'registrantCountry') this.registrant.country ??= /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value;
    else if (field === 'registrantEmail') {
      const e = normalizeEmail(value);
      if (e) this.registrant.email = uniq([...this.registrant.email, e]);
    } else if (field === 'registrantPhone' && /\d/.test(value)) this.registrant.tel = uniq([...this.registrant.tel, value]);
  }

  result(): ParsedWhois {
    const out: ParsedWhois = {};
    if (this.ldhName) out.ldhName = this.ldhName;
    if (this.status.length) out.status = this.status;
    if (this.registered) out.registered = this.registered;
    if (this.expires) out.expires = this.expires;
    if (this.lastChanged) out.lastChanged = this.lastChanged;
    if (this.ns.length) out.nameservers = this.ns;
    const r = this.registrar;
    if (r.name || r.ianaId || r.url || r.abuseEmail.length || r.abuseTel.length) {
      const reg: RdapRegistrar = { abuseEmail: r.abuseEmail, abuseTel: r.abuseTel };
      if (r.name) reg.name = r.name;
      if (r.ianaId) reg.ianaId = r.ianaId;
      if (r.url) reg.url = r.url;
      out.registrar = reg;
    }
    if (r.abuseEmail.length) out.registrarAbuseEmail = r.abuseEmail;
    if (this.registrantSeen) {
      const c: RdapContact = { roles: ['registrant'], email: this.registrant.email, tel: this.registrant.tel, redacted: this.registrantRedacted };
      if (this.registrant.name) c.name = this.registrant.name;
      if (this.registrant.org) c.org = this.registrant.org;
      if (this.registrant.country) c.country = this.registrant.country;
      out.registrant = c;
    }
    return out;
  }
}

/**
 * Parses pasted WHOIS output: the ICANN gTLD format ("Registrar:", "Registry
 * Expiry Date:", "Domain Status:", "Name Server:"…) and common ccTLD layouts
 * (DENIC "Nserver:"/"Changed:", Nominet and EURid indented blocks). Only
 * fields that were found are present in the result.
 */
export function parseWhoisText(text: string): ParsedWhois {
  const b = new WhoisBuilder();
  // An indented block under a "Key:" line with no value (Nominet, EURid).
  let block: { key: string; indent: number; values: number } | null = null;
  for (const line of lines(text)) {
    if (!line.trim()) {
      block = null;
      continue;
    }
    if (/^\s*(?:[%#;]|>>>)/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const kv = KV.exec(line);
    if (block && indent > block.indent) {
      const sub = kv ? BLOCK_SUBFIELDS[block.key]?.[normKey(kv[1] ?? '')] : undefined;
      if (kv && sub) b.set(sub, kv[2] ?? '');
      else if (kv && FIELD_BY_KEY.has(normKey(kv[1] ?? ''))) b.set(FIELD_BY_KEY.get(normKey(kv[1] ?? '')) as Field, kv[2] ?? '');
      else if (!kv || BLOCK_VALUE_FIELDS.has(block.key)) {
        const f = blockField(block.key);
        // A registrant block's later lines are prose ("Visit www.eurid.eu …").
        if (f && !(f === 'registrantName' && block.values > 0)) b.set(f, line);
        block.values++;
      }
      continue;
    }
    if (kv && !(kv[2] ?? '').trim()) {
      block = { key: normKey(kv[1] ?? ''), indent, values: 0 };
      continue;
    }
    block = null;
    if (!kv) continue;
    const field = FIELD_BY_KEY.get(normKey(kv[1] ?? ''));
    if (field) b.set(field, kv[2] ?? '');
  }
  return b.result();
}

/** Blocks whose indented lines are values even when they contain a colon (IPv6 glue). */
const BLOCK_VALUE_FIELDS = new Set(['name servers', 'nameservers', 'name server', 'nserver']);

function blockField(key: string): Field | undefined {
  if (key === 'registrar') return 'registrar';
  if (key === 'registrant') return 'registrantName';
  if (key === 'domain name' || key === 'domain') return 'domain';
  const f = FIELD_BY_KEY.get(key);
  return f === 'ns' || f === 'status' ? f : undefined;
}

// ───────────────────────────── Pasted RDAP ─────────────────────────────

/** Parses pasted RDAP JSON for a domain. Returns null for invalid JSON or a non-domain object. */
export function parsePastedRdap(text: string): RdapDomain | null {
  if (typeof text !== 'string' || text.length > MAX_PASTE) return null;
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return null;
  }
  return parseRdapDomain(json, 'manual');
}

// ───────────────────────────── Pasted DNS ─────────────────────────────

const RCODES: Readonly<Record<string, number>> = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };

function typeCode(t: string): number | undefined {
  const u = t.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(RR_CODES, u)) return RR_CODES[u as RRType];
  if (Object.prototype.hasOwnProperty.call(EXTRA_RR_CODES, u)) return EXTRA_RR_CODES[u];
  const m = /^TYPE(\d{1,5})$/.exec(u);
  return m && Number(m[1]) <= 65535 ? Number(m[1]) : undefined;
}

type Section = 'answer' | 'authority' | 'additional';

const RECORD_LINE = /^(\S+)\s+(?:(\d{1,10})\s+)?(?:(?:IN|CH|HS|CS)\s+)?([A-Za-z][A-Za-z0-9]*)\s+(\S.*)$/;

function shortLineValid(type: RRType, line: string): boolean {
  switch (type) {
    case 'A':
      return isIPv4(line);
    case 'AAAA':
      return isIPv6(line);
    case 'MX':
      return /^\d{1,5}\s+\S+$/.test(line);
    case 'NS':
    case 'CNAME':
      return /^[a-z0-9._-]+\.?$/i.test(line);
    default:
      return true;
  }
}

/**
 * Best-effort parse of pasted DNS output: full dig output (status, flags,
 * question and sections), bare "name TTL IN TYPE data" lines, `dig +short`
 * output when `query` says what was asked, or a pasted DoH JSON body.
 * Returns null when nothing recognisable was found.
 */
export function parsePastedDns(text: string, query?: { name: string; type: RRType }): DnsAnswer | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return parsePastedDohJson(trimmed, query);

  let rcode: number | undefined;
  let ad = false;
  let qName: string | undefined;
  let qType: RRType | undefined;
  let section: Section = 'answer';
  const answers: DnsRecord[] = [];
  const authority: DnsRecord[] = [];
  const shortLines: string[] = [];

  for (const raw of lines(text)) {
    const line = raw.trim();
    if (!line) continue;
    const status = /status:\s*([A-Z]+)/.exec(line);
    if (status && line.startsWith(';')) {
      rcode = RCODES[status[1] ?? ''] ?? rcode;
      continue;
    }
    const flags = /^;;\s*flags:([^;]*)/.exec(line);
    if (flags) {
      ad = /\bad\b/.test(flags[1] ?? '');
      continue;
    }
    const sec = /^;;\s*(ANSWER|AUTHORITY|ADDITIONAL) SECTION:/i.exec(line);
    if (sec) {
      section = (sec[1] ?? '').toLowerCase() as Section;
      continue;
    }
    const question = /^;([^;\s]\S*)\s+(?:(?:IN|CH|HS)\s+)?([A-Za-z][A-Za-z0-9]*)\s*$/.exec(line);
    if (question) {
      qName ??= normalizeHost(question[1]);
      const code = typeCode(question[2] ?? '');
      qType ??= code === undefined ? undefined : rrTypeOf(code);
      continue;
    }
    if (line.startsWith(';')) continue;
    const m = RECORD_LINE.exec(line);
    const code = m ? typeCode(m[3] ?? '') : undefined;
    if (m && code !== undefined) {
      const data = cleanText(m[4], 16_384);
      if (!data) continue;
      const rec: DnsRecord = { name: normalizeHost(m[1]) ?? '', type: code, ttl: m[2] ? Math.min(Number(m[2]), 2 ** 31 - 1) : 0, data: normalizeRecordData(code, data) };
      if (section === 'answer' && answers.length < 500) answers.push(rec);
      else if (section === 'authority' && authority.length < 500) authority.push(rec);
      continue;
    }
    if (shortLines.length < 500) shortLines.push(line);
  }

  const name = normalizeHost(query?.name) ?? qName ?? answers[0]?.name;
  const type = query?.type ?? qType ?? (answers[0] ? rrTypeOf(answers[0].type) : undefined);
  if (!name || !type) return null;

  // `dig +short`: bare data lines, only when nothing else was recognised.
  if (answers.length === 0 && authority.length === 0 && rcode === undefined && query) {
    const valid = shortLines.filter((l) => shortLineValid(type, l));
    if (valid.length === 0) return null;
    const code = RR_CODES[type];
    for (const l of valid) answers.push({ name, type: code, ttl: 0, data: normalizeRecordData(code, l) });
  }
  if (rcode === undefined && answers.length === 0 && authority.length === 0) return null;
  return { name, type, rcode: rcode ?? 0, ad, answers, authority, resolver: 'manual' };
}

function parsePastedDohJson(text: string, query?: { name: string; type: RRType }): DnsAnswer | null {
  if (text.length > MAX_PASTE) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  let name = query?.name;
  let type = query?.type;
  if (isRecord(json) && Array.isArray(json.Question) && isRecord(json.Question[0])) {
    const q = json.Question[0];
    name ??= normalizeHost(q.name);
    type ??= typeof q.type === 'number' ? rrTypeOf(q.type) : undefined;
  }
  if (!name || !type) return null;
  return parseDohJson(json, 'manual', name, type);
}
