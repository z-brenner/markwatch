// DNS over HTTPS, JSON flavour (Cloudflare and Google). Builders and parsers
// only; the BrowserCollector performs the fetch. Responses are untrusted:
// every field is validated, capped and normalized here.
//
// Shapes seen in captured responses (tests/fixtures/doh):
//  - Google writes owner names with a trailing dot, Cloudflare without.
//  - Cloudflare keeps TXT quoting ("\"v=spf1 -all\""), Google strips it.
//  - "Comment" is a string (Google) or an array of strings (Cloudflare).
//  - Google adds "extended_dns_errors": [{ info_code, extra_text }].
import { RR_CODES, type DnsAnswer, type DnsRecord, type DnsResolver, type RRType } from '../types';
import { asArray, cleanText, isRecord, normalizeHost } from '../net/clean';
import { uniq } from '../util';
import { isIPv4, isIPv6 } from '../net/ip';

/** Most records kept per section; real answers are far smaller. */
export const MAX_RECORDS = 500;
/** Longest record data kept (a TXT RRset can legitimately reach a few KB). */
export const MAX_DATA = 16_384;

const RR_BY_CODE = new Map<number, RRType>(Object.entries(RR_CODES).map(([k, v]) => [v, k as RRType]));

/** Extra numeric codes recognised when reading pasted text, beyond RRType. */
export const EXTRA_RR_CODES: Readonly<Record<string, number>> = {
  PTR: 12,
  HINFO: 13,
  RP: 17,
  SRV: 33,
  NAPTR: 35,
  DS: 43,
  RRSIG: 46,
  NSEC: 47,
  DNSKEY: 48,
  NSEC3: 50,
  SVCB: 64,
  HTTPS: 65,
  CAA: 257,
};

/** RRType for a numeric code, if it is one of ours. */
export function rrTypeOf(code: number): RRType | undefined {
  return RR_BY_CODE.get(code);
}

export function dohUrl(resolver: 'cloudflare' | 'google', name: string, type: RRType): { url: string; headers: Record<string, string> } {
  const q = `name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  if (resolver === 'cloudflare') {
    // The ct=application/dns-json query parameter returns 400; the Accept header is required.
    return { url: `https://cloudflare-dns.com/dns-query?${q}`, headers: { accept: 'application/dns-json' } };
  }
  return { url: `https://dns.google/resolve?${q}`, headers: {} };
}

/** Google's human-readable lookup page, for "open in new tab". */
export function manualDnsUrl(name: string, type: RRType): string {
  return `https://dns.google/query?name=${encodeURIComponent(name)}&rr_type=${encodeURIComponent(type)}`;
}

/**
 * Decodes presentation-format TXT data: one or more quoted character-strings
 * (`"a" "b"`) are unescaped (\" \\ \DDD) and concatenated. Unquoted data is
 * returned as is (Google already strips quotes).
 */
export function decodeTxt(data: string): string {
  const s = data.trim();
  if (!s.startsWith('"')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i] ?? '')) i++;
    if (i >= s.length) break;
    if (s[i] !== '"') {
      // Not a well-formed sequence of quoted strings; fall back to the raw value.
      return s;
    }
    i++;
    let closed = false;
    while (i < s.length) {
      const c = s[i] ?? '';
      if (c === '\\') {
        const next3 = s.slice(i + 1, i + 4);
        if (/^\d{3}$/.test(next3)) {
          const code = Number(next3);
          out += code <= 255 ? String.fromCharCode(code) : '';
          i += 4;
        } else {
          out += s[i + 1] ?? '';
          i += 2;
        }
      } else if (c === '"') {
        i++;
        closed = true;
        break;
      } else {
        out += c;
        i++;
      }
    }
    if (!closed) return s;
  }
  return out;
}

/**
 * Normalizes record data by numeric type: TXT is unquoted and joined; NS,
 * CNAME and PTR targets are lowercased without the trailing dot; MX keeps
 * "pref host" with the host normalized the same way; A/AAAA are lowercased.
 */
export function normalizeRecordData(type: number, data: string): string {
  switch (type) {
    case RR_CODES.TXT:
      return decodeTxt(data);
    case RR_CODES.NS:
    case RR_CODES.CNAME:
    case EXTRA_RR_CODES.PTR:
      return normalizeHost(data) ?? '';
    case RR_CODES.MX: {
      const m = /^(\d{1,5})\s+(\S+)$/.exec(data.trim());
      if (!m) return data.trim().toLowerCase();
      const host = (m[2] ?? '').toLowerCase();
      // Null MX (RFC 7505) is "0 ." — keep the dot so it stays recognisable.
      return `${Number(m[1])} ${host === '.' ? '.' : host.replace(/\.$/, '')}`;
    }
    case RR_CODES.A:
    case RR_CODES.AAAA:
      return data.trim().toLowerCase();
    default:
      return data.trim();
  }
}

function parseRecords(v: unknown): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const r of asArray(v, MAX_RECORDS)) {
    if (!isRecord(r)) continue;
    const type = r.type;
    if (typeof type !== 'number' || !Number.isInteger(type) || type < 0 || type > 65535) continue;
    const name = normalizeHost(r.name) ?? '';
    const rawData = cleanText(r.data, MAX_DATA);
    if (rawData === undefined) continue;
    const ttl = typeof r.TTL === 'number' && Number.isFinite(r.TTL) && r.TTL >= 0 ? Math.min(Math.floor(r.TTL), 2 ** 31 - 1) : 0;
    out.push({ name, type, ttl, data: normalizeRecordData(type, rawData) });
  }
  return out;
}

function parseComment(json: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const c = json.Comment;
  if (typeof c === 'string') parts.push(c);
  else for (const x of asArray(c, 20)) if (typeof x === 'string') parts.push(x);
  for (const e of asArray(json.extended_dns_errors, 20)) {
    if (!isRecord(e)) continue;
    const code = typeof e.info_code === 'number' && Number.isInteger(e.info_code) ? e.info_code : undefined;
    const text = cleanText(e.extra_text, 300);
    if (code === undefined && !text) continue;
    parts.push(`EDE(${code ?? '?'})${text ? `: ${text}` : ''}`);
  }
  return cleanText(uniq(parts.map((p) => cleanText(p, 500)).filter((p): p is string => !!p)).join('; '), 1000);
}

/**
 * Parses a DoH JSON response. Returns null when the body is not a DoH JSON
 * object with a numeric Status. Malformed records are skipped, not fatal.
 */
export function parseDohJson(json: unknown, resolver: DnsResolver, name: string, type: RRType): DnsAnswer | null {
  if (!isRecord(json)) return null;
  const status = json.Status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 4095) return null;
  const answer: DnsAnswer = {
    name: normalizeHost(name) ?? '',
    type,
    rcode: status,
    ad: json.AD === true,
    answers: parseRecords(json.Answer),
    authority: parseRecords(json.Authority),
    resolver,
  };
  const comment = parseComment(json);
  if (comment) answer.comment = comment;
  return answer;
}

/** Answer-section records of the given type (CNAME chains are not followed or filtered). */
export function recordsOfType(answer: DnsAnswer, rr: RRType): DnsRecord[] {
  const code = RR_CODES[rr];
  return answer.answers.filter((r) => r.type === code);
}

/** Distinct nameserver host names from the answer section. */
export function nsHosts(answer: DnsAnswer): string[] {
  return uniq(recordsOfType(answer, 'NS').map((r) => r.data).filter((h) => h.length > 0));
}

/**
 * Distinct mail exchanger hosts, ordered by preference (lowest first). The
 * RFC 7505 null MX ("0 .", "this domain accepts no mail") yields no host.
 */
export function mxHosts(answer: DnsAnswer): string[] {
  const parsed = recordsOfType(answer, 'MX').map((r, i) => {
    const m = /^(\d{1,5})\s+(\S+)$/.exec(r.data);
    return { pref: m ? Number(m[1]) : 65535, host: m ? (m[2] ?? '') : r.data.split(/\s+/).pop() ?? '', i };
  });
  parsed.sort((a, b) => a.pref - b.pref || a.i - b.i);
  return uniq(parsed.map((p) => normalizeHost(p.host) ?? '').filter((h) => h.length > 0 && h !== '.'));
}

/** Valid IPv4 addresses from A records. */
export function aRecords(answer: DnsAnswer): string[] {
  return uniq(recordsOfType(answer, 'A').map((r) => r.data).filter(isIPv4));
}

/** Valid IPv6 addresses from AAAA records (lowercase, as returned). */
export function aaaaRecords(answer: DnsAnswer): string[] {
  return uniq(recordsOfType(answer, 'AAAA').map((r) => r.data).filter(isIPv6));
}

/** TXT strings with quoting removed and multi-string records joined. */
export function txtRecords(answer: DnsAnswer): string[] {
  return recordsOfType(answer, 'TXT').map((r) => r.data);
}
