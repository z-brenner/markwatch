// jCard (RFC 7095) helpers for RDAP entities. A jCard is
//   ["vcard", [[name, params, valueType, value, ...moreValues], ...]]
// Everything is untrusted: malformed properties are skipped, strings capped.
import { uniq } from '../util';
import { asArray, cleanText, isRecord, normalizeEmail } from '../net/clean';

export interface VcardProperty {
  /** Lowercased property name ("fn", "email", "adr"…). */
  name: string;
  params: Record<string, unknown>;
  valueType: string;
  /** The value(s) after the type: usually one string; structured for adr/org/n. */
  values: unknown[];
}

export interface VcardSummary {
  fn?: string;
  org?: string;
  /** "individual" | "org" | "group" | … (lowercased). */
  kind?: string;
  emails: string[];
  tels: string[];
  /** ISO 3166 alpha-2 code (uppercase) when given, else the country name from the address. */
  country?: string;
  url?: string;
}

/** Properties of a jCard; [] for anything that is not one. */
export function vcardProperties(vcardArray: unknown): VcardProperty[] {
  if (!Array.isArray(vcardArray) || vcardArray[0] !== 'vcard') return [];
  const out: VcardProperty[] = [];
  for (const p of asArray(vcardArray[1], 300)) {
    if (!Array.isArray(p) || p.length < 4 || typeof p[0] !== 'string' || typeof p[2] !== 'string') continue;
    out.push({ name: p[0].toLowerCase(), params: isRecord(p[1]) ? p[1] : {}, valueType: p[2].toLowerCase(), values: p.slice(3, 20) });
  }
  return out;
}

/** Flattens a (possibly structured) value into one display string. */
function flatText(v: unknown, depth = 0): string | undefined {
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v) && depth < 2) {
    const parts = v
      .slice(0, 20)
      .map((x) => flatText(x, depth + 1))
      .filter((x): x is string => !!x);
    return cleanText(parts.join(', '));
  }
  return undefined;
}

/** First non-empty text value of the named property. */
export function vcardText(props: VcardProperty[], name: string): string | undefined {
  for (const p of props) {
    if (p.name !== name) continue;
    const t = flatText(p.values.length === 1 ? p.values[0] : p.values);
    if (t) return t;
  }
  return undefined;
}

/** Plausible, lowercased, distinct email addresses. Empty strings ("" is common) are dropped. */
export function vcardEmails(props: VcardProperty[]): string[] {
  const out: string[] = [];
  for (const p of props) {
    if (p.name !== 'email') continue;
    for (const v of p.values) {
      const e = normalizeEmail(v);
      if (e) out.push(e);
    }
  }
  return uniq(out);
}

/**
 * Telephone numbers. "tel:" URIs (RFC 3966) are unwrapped, keeping an
 * extension as " ext. N"; other URI parameters are dropped.
 */
export function vcardTels(props: VcardProperty[]): string[] {
  const out: string[] = [];
  for (const p of props) {
    if (p.name !== 'tel') continue;
    for (const v of p.values) {
      let t = cleanText(v, 100);
      if (!t) continue;
      if (/^tel:/i.test(t)) {
        const [num = '', ...params] = t.slice(4).split(';');
        const ext = params.find((x) => /^ext=/i.test(x))?.slice(4);
        t = num + (ext ? ` ext. ${ext}` : '');
      }
      t = t.trim();
      if (/\d/.test(t)) out.push(t);
    }
  }
  return uniq(out);
}

/**
 * Country of the first address: the RFC 8605 "cc" parameter if present, else
 * the country-name component (index 6) of the structured adr value.
 */
export function vcardCountry(props: VcardProperty[]): string | undefined {
  for (const p of props) {
    if (p.name !== 'adr') continue;
    const cc = cleanText(p.params.cc, 10);
    if (cc && /^[a-z]{2}$/i.test(cc)) return cc.toUpperCase();
    const adr = p.values[0];
    if (Array.isArray(adr)) {
      const name = flatText(adr[6]);
      if (name) return name;
    }
  }
  return undefined;
}

export function vcardKind(props: VcardProperty[]): string | undefined {
  return vcardText(props, 'kind')?.toLowerCase();
}

/** First http(s) URL property. */
export function vcardUrl(props: VcardProperty[]): string | undefined {
  const u = vcardText(props, 'url');
  return u && /^https?:\/\/\S+$/i.test(u) ? u : undefined;
}

/** Everything Markwatch reads from a jCard, in one pass. */
export function parseVcard(vcardArray: unknown): VcardSummary {
  const props = vcardProperties(vcardArray);
  const out: VcardSummary = { emails: vcardEmails(props), tels: vcardTels(props) };
  const fn = vcardText(props, 'fn');
  const org = vcardText(props, 'org');
  const kind = vcardKind(props);
  const country = vcardCountry(props);
  const url = vcardUrl(props);
  if (fn) out.fn = fn;
  if (org) out.org = org;
  if (kind) out.kind = kind;
  if (country) out.country = country;
  if (url) out.url = url;
  return out;
}
