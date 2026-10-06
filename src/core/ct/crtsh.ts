// Certificate Transparency search via crt.sh. Builders and parsers only.
//
// Query form, verified against crt.sh on 2026-10-05:
//  - "term%"   (prefix)      works: every identity starting with the term.
//  - "%.x.tld" (subdomains)  works.
//  - "%term%"  (substring)   returns [] even when matching certificates exist.
//  - "%term"   (leading %)   is refused: "Unsupported use of '%'".
// The builders therefore default to the prefix form. An empty result from the
// substring form must not be read as "no certificates", so it is opt-in only.
// crt.sh allows 5 requests per minute per IP and often answers 502 or times out.
//
// Row fields seen: id, issuer_ca_id, issuer_name, common_name, name_value
// (newline-separated identities), not_before, not_after, serial_number,
// result_count. Timestamps have no zone and are UTC. entry_timestamp is no
// longer present but is read when it is. Precertificate and certificate are
// separate rows with distinct ids.
import type { CtEntry } from '../types';
import { uniq } from '../util';
import { asArray, cleanText, isRecord, toIsoUtc } from '../net/clean';

export type CrtshMode = 'prefix' | 'substring';

/** Rows kept from one response; a broad term can return tens of thousands. */
export const MAX_CT_ROWS = 10_000;
const MAX_NAMES_PER_CERT = 1000;

function q(term: string, mode: CrtshMode): string {
  const t = encodeURIComponent(term.trim().toLowerCase());
  return mode === 'substring' ? `%25${t}%25` : `${t}%25`;
}

/** JSON search URL for live certificates matching `term` (prefix search by default; see header). */
export function crtshUrl(term: string, mode: CrtshMode = 'prefix'): string {
  return `https://crt.sh/?q=${q(term, mode)}&output=json&exclude=expired`;
}

/** The same search as a human-readable page, for "open in new tab". */
export function manualCrtshUrl(term: string, mode: CrtshMode = 'prefix'): string {
  return `https://crt.sh/?q=${q(term, mode)}&exclude=expired`;
}

// DNS-name identities only. crt.sh also lists email addresses (S/MIME) and IPs.
const NAME_RE = /^(?:\*\.)?(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseNames(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    for (const raw of v.slice(0, 256 * 1024).split('\n', MAX_NAMES_PER_CERT)) {
      const n = raw.trim().toLowerCase().replace(/\.$/, '');
      // The last label must contain a letter: that rules out IPv4 literals.
      if (n.length <= 253 && NAME_RE.test(n) && n.includes('.') && /[a-z]/.test(n.slice(n.lastIndexOf('.') + 1))) out.push(n);
    }
  }
  return uniq(out).slice(0, MAX_NAMES_PER_CERT);
}

function parseId(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v);
  return undefined;
}

/**
 * Parses a crt.sh JSON response. Returns null when the body is not an array
 * (so a malformed answer is never mistaken for "no certificates"). Rows
 * without an id or validity dates are skipped; duplicate ids are merged.
 */
export function parseCrtsh(json: unknown): CtEntry[] | null {
  if (!Array.isArray(json)) return null;
  const byId = new Map<number, CtEntry>();
  for (const row of asArray(json, MAX_CT_ROWS)) {
    if (!isRecord(row)) continue;
    const id = parseId(row.id);
    const notBefore = toIsoUtc(row.not_before);
    const notAfter = toIsoUtc(row.not_after);
    if (id === undefined || !notBefore || !notAfter) continue;
    const commonName = cleanText(row.common_name, 253)?.toLowerCase() ?? '';
    const names = parseNames(row.common_name, row.name_value);
    const existing = byId.get(id);
    if (existing) {
      existing.names = uniq([...existing.names, ...names]).slice(0, MAX_NAMES_PER_CERT);
      continue;
    }
    const entry: CtEntry = { id, commonName, names, issuer: cleanText(row.issuer_name, 500) ?? '', notBefore, notAfter };
    const entryTimestamp = toIsoUtc(row.entry_timestamp);
    if (entryTimestamp) entry.entryTimestamp = entryTimestamp;
    byId.set(id, entry);
  }
  return [...byId.values()];
}

/**
 * Groups certificates by the registrable domain of each name on them, after
 * stripping a leading "*." wildcard. `registrableFn` maps a host name to its
 * registrable domain (eTLD+1), returning null/undefined when there is none.
 * Keys appear in first-seen order; each entry is listed once per key.
 */
export function registrableNamesFromCt(entries: readonly CtEntry[], registrableFn: (name: string) => string | null | undefined): Map<string, CtEntry[]> {
  const out = new Map<string, CtEntry[]>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const name of entry.names) {
      const host = name.startsWith('*.') ? name.slice(2) : name;
      if (!host || host.includes('*')) continue;
      const reg = registrableFn(host);
      if (!reg || seen.has(reg)) continue;
      seen.add(reg);
      const list = out.get(reg);
      if (list) list.push(entry);
      else out.set(reg, [entry]);
    }
  }
  return out;
}
