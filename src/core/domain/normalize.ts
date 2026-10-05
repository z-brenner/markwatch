// Hostname normalization and validation. Everything downstream (permutation
// output, inventory, CT names, manual input) passes through here, so this is
// the one place that decides what a valid domain looks like.

import punycode from 'punycode/punycode.js';

const MAX_LABEL = 63;
const MAX_DOMAIN = 253;
const LDH_LABEL = /^[a-z0-9-]+$/;
const ASCII_ONLY = /^\p{ASCII}*$/u;

export const isAscii = (s: string): boolean => ASCII_ONLY.test(s);

// Non-ASCII code points allowed in a U-label: lowercase/other letters, marks
// and decimal digits. Combined with the NFKC+lowercase stability check below,
// this approximates IDNA2008 PVALID closely enough to reject what registries
// and browsers reject (uppercase, compatibility forms such as fullwidth or
// superscript letters, symbols, emoji, spaces, control characters).
const IDN_CHAR = /^[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}]$/u;
const COMBINING_MARK = /^\p{M}/u;

// UTS #46 maps these to "." before splitting labels.
const DOT_VARIANTS = /[\u3002\uff0e\uff61]/g;

const idnCharCache = new Map<string, boolean>();
function isIdnChar(ch: string): boolean {
  let ok = idnCharCache.get(ch);
  if (ok === undefined) {
    ok = IDN_CHAR.test(ch) && ch.normalize('NFKC').toLowerCase().normalize('NFKC') === ch;
    idnCharCache.set(ch, ok);
  }
  return ok;
}

/** Hyphen rules shared by A-labels and U-labels (RFC 5891 §4.2.3.1). */
function hyphensOk(label: string): boolean {
  return !label.startsWith('-') && !label.endsWith('-');
}

/** Character and hyphen rules for a non-ASCII U-label (lowercase/NFC input); length is checked on the encoded form. */
function unicodeLabelCharsOk(label: string): boolean {
  if (!hyphensOk(label) || label.slice(2, 4) === '--') return false;
  if (label.normalize('NFC') !== label || COMBINING_MARK.test(label)) return false;
  for (const ch of label) {
    if (ch.charCodeAt(0) < 0x80 ? !/[a-z0-9-]/.test(ch) : !isIdnChar(ch)) return false;
  }
  return true;
}

/**
 * True if `label` (Unicode, already lowercase/NFC) is a registrable label:
 * an LDH label, or a U-label whose IDNA encoding is a valid A-label.
 */
export function isValidUnicodeLabel(label: string): boolean {
  if (ASCII_ONLY.test(label)) return isValidAsciiLabel(label);
  return unicodeLabelCharsOk(label) && ('xn--' + punycode.encode(label)).length <= MAX_LABEL;
}

/**
 * True if `label` is a valid ASCII DNS label as used by Markwatch: LDH, 1–63
 * chars, no leading/trailing hyphen, and "--" in positions 3–4 only for an
 * "xn--" label that decodes to a valid U-label and round-trips exactly.
 */
export function isValidAsciiLabel(label: string): boolean {
  if (label.length === 0 || label.length > MAX_LABEL || !LDH_LABEL.test(label) || !hyphensOk(label)) return false;
  if (label.slice(2, 4) !== '--') return true;
  if (!label.startsWith('xn--')) return false;
  let decoded: string;
  try {
    decoded = punycode.toUnicode(label);
  } catch {
    return false;
  }
  // A pure-ASCII decode means the label is not a real A-label.
  if (ASCII_ONLY.test(decoded) || !unicodeLabelCharsOk(decoded)) return false;
  return punycode.toASCII(decoded) === label;
}

/** True if `ascii` is a valid lowercase multi-label ASCII hostname (not an IP address). */
export function isValidAsciiDomain(ascii: string): boolean {
  if (ascii.length === 0 || ascii.length > MAX_DOMAIN) return false;
  const labels = ascii.split('.');
  if (labels.length < 2) return false;
  // No TLD is all-numeric; this also rejects IPv4 addresses.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return false;
  return labels.every(isValidAsciiLabel);
}

/**
 * IDNA-encodes an already-clean Unicode hostname (lowercase, NFC, no trailing
 * dot) label by label. Returns null if any label cannot be encoded or the
 * result is not a valid hostname. This is the fast path the permutation engine
 * uses; `normalizeDomain` is the forgiving front door for user input.
 */
export function encodeDomain(unicode: string): string | null {
  if (ASCII_ONLY.test(unicode)) return isValidAsciiDomain(unicode) ? unicode : null;
  const out: string[] = [];
  for (const label of unicode.split('.')) {
    if (ASCII_ONLY.test(label)) {
      out.push(label);
    } else {
      if (!unicodeLabelCharsOk(label)) return null;
      out.push('xn--' + punycode.encode(label));
    }
  }
  const ascii = out.join('.');
  return isValidAsciiDomain(ascii) ? ascii : null;
}

/** Strips scheme, credentials, path, query, fragment and port from a URL-ish string. */
function extractHost(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  const end = s.search(/[/?#\\]/);
  if (end >= 0) s = s.slice(0, end);
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  // Bracketed IPv6 literal, or a bare IPv6 address.
  if (s.startsWith('[') || (s.match(/:/g)?.length ?? 0) > 1) return null;
  s = s.replace(/:\d*$/, '');
  return s;
}

/**
 * Normalizes user- or feed-supplied input to a canonical hostname.
 * Accepts URLs, surrounding whitespace, a trailing dot, mixed case, Unicode or
 * punycode. Does NOT strip "www." because that is a distinct hostname.
 */
export function normalizeDomain(input: string): { ascii: string; unicode: string } | null {
  let host = extractHost(input);
  if (host === null) return null;
  host = host.normalize('NFC').toLowerCase().normalize('NFC').replace(DOT_VARIANTS, '.');
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || /\s/.test(host)) return null;

  const labels = host.split('.');
  const ascii: string[] = [];
  for (const label of labels) {
    if (label.length === 0) return null;
    if (ASCII_ONLY.test(label)) {
      ascii.push(label);
    } else {
      if (!unicodeLabelCharsOk(label)) return null;
      ascii.push('xn--' + punycode.encode(label));
    }
  }
  const asciiDomain = ascii.join('.');
  if (!isValidAsciiDomain(asciiDomain)) return null;
  return { ascii: asciiDomain, unicode: punycode.toUnicode(asciiDomain) };
}
