// Small helpers for strings that come from the network or from the user's
// clipboard. Everything here treats its input as untrusted: values are capped,
// control characters are dropped, and nothing throws.
import type { IsoUtc } from '../types';

/** Default cap for a single human-readable field (names, org, status…). */
export const MAX_FIELD = 1000;

// C0/C1 control characters except tab and newline, plus bidi overrides and
// zero-width characters that could disguise a value in the UI.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Returns a trimmed, length-capped copy of `v` with control characters removed,
 * or undefined when `v` is not a string or is empty after cleaning.
 */
export function cleanText(v: unknown, max = MAX_FIELD): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = (v.length > max * 4 ? v.slice(0, max * 4) : v).replace(CONTROL, '').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

/** Lowercase, trimmed host name without a trailing dot. Undefined when empty or not a string. */
export function normalizeHost(v: unknown): string | undefined {
  const s = cleanText(v, 253 + 1);
  if (!s) return undefined;
  const h = s.toLowerCase().replace(/\.$/, '');
  return h || undefined;
}

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/;

/** True for a syntactically plausible ASCII host name (LDH labels, underscores tolerated). */
export function isHostName(h: string): boolean {
  return HOST_RE.test(h);
}

/**
 * True when `host` equals `suffix` or ends with "." + suffix (label-aligned),
 * so "ns.cloudflare.com" matches "hera.ns.cloudflare.com" but not "xns.cloudflare.com".
 */
export function hostHasSuffix(host: string, suffix: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const s = suffix.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  if (!s) return false;
  return h === s || h.endsWith(`.${s}`);
}

const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True for a plausible, ASCII, lowercase-insensitive email address (≤ 254 chars). */
export function isPlausibleEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s.toLowerCase());
}

/**
 * Normalizes an email address from untrusted data: trims, strips a leading
 * "mailto:" and surrounding angle brackets, lowercases. Returns undefined
 * unless the result is a plausible address.
 */
export function normalizeEmail(v: unknown): string | undefined {
  const s = cleanText(v, 320);
  if (!s) return undefined;
  const e = s
    .replace(/^mailto:/i, '')
    .replace(/^<(.*)>$/, '$1')
    .trim()
    .toLowerCase();
  return isPlausibleEmail(e) ? e : undefined;
}

// ISO-8601 date-time with optional fraction and optional zone. A bare date is
// accepted too. Strings without a zone are taken as UTC (crt.sh, some WHOIS).
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Parses an ISO-8601 timestamp and returns it as UTC with a "Z" suffix
 * (millisecond precision). Values without a time zone are interpreted as UTC.
 * Returns undefined for anything else, including impossible dates.
 */
export function toIsoUtc(v: unknown): IsoUtc | undefined {
  const s = cleanText(v, 64);
  if (!s) return undefined;
  const m = ISO_RE.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h = '00', mi = '00', sec = '00', frac = '', zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(sec);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return undefined;
  const ms = frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0;
  let t = Date.UTC(year, month - 1, day, hour, minute, Math.min(second, 59), ms);
  // Reject rollovers such as Feb 30.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  if (zone && zone !== 'Z' && zone !== 'z') {
    const zm = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
    if (!zm) return undefined;
    const sign = zm[1] === '-' ? -1 : 1;
    const offset = Number(zm[2]) * 60 + Number(zm[3] ?? '0');
    if (offset > 18 * 60) return undefined;
    t -= sign * offset * 60_000;
  }
  const out = new Date(t);
  return Number.isNaN(out.getTime()) ? undefined : out.toISOString();
}

/** Narrowing helper: a non-null, non-array object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The array itself when `v` is an array (capped to `max` items), otherwise an empty array. */
export function asArray(v: unknown, max = 1000): unknown[] {
  if (!Array.isArray(v)) return [];
  return v.length > max ? v.slice(0, max) : v;
}
