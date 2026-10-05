// RFC 5322 / MIME .eml builder for "open as a draft in your mail client".
// - CRLF line endings throughout.
// - X-Unsent: 1 so Outlook opens the file as an editable, unsent draft.
// - text/plain; charset=utf-8, quoted-printable body.
// - RFC 2047 encoded-words for non-ASCII header text; RFC 2231 filenames.
// - Every header value is stripped of CR, LF and other control characters
//   before use, so lookup data or user input cannot inject headers.
// Output is deterministic for a given input (the MIME boundary is derived from
// the content), which keeps exports hashable and testable.

export interface EmlAttachment {
  name: string;
  type: string;
  data: Uint8Array;
}

export interface EmlMessage {
  from?: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  attachments?: EmlAttachment[];
}

const CRLF = '\r\n';
const utf8 = new TextEncoder();

/** Replaces CR, LF, TAB, other C0/C1 controls and Unicode line separators with a space. */
export function sanitizeHeaderValue(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// ───────────── base64 ─────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}${B64.charAt((n >> 6) & 63)}=`;
  }
  return out;
}

function wrap76(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join(CRLF);
}

// ───────────── quoted-printable (RFC 2045 §6.7) ─────────────

export function quotedPrintable(text: string): string {
  const hex = (b: number): string => `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
  const outLines: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bytes = utf8.encode(line);
    const tokens: string[] = [];
    bytes.forEach((b, idx) => {
      const last = idx === bytes.length - 1;
      if ((b === 0x20 || b === 0x09) && !last) tokens.push(String.fromCharCode(b));
      else if (b >= 33 && b <= 126 && b !== 61) tokens.push(String.fromCharCode(b));
      else tokens.push(hex(b));
    });
    let cur = '';
    for (const tok of tokens) {
      // 76 characters max per line, including the trailing "=" of a soft break.
      if (cur.length + tok.length > 75) {
        outLines.push(`${cur}=`);
        cur = '';
      }
      cur += tok;
    }
    outLines.push(cur);
  }
  return outLines.join(CRLF);
}

// ───────────── RFC 2047 encoded-words ─────────────

const isAscii = (s: string): boolean => /^[\x20-\x7E]*$/.test(s);

/** Splits text into B-encoded UTF-8 words of at most 75 characters, never splitting a code point. */
export function encodedWords(text: string): string[] {
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length) words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
    chunk = [];
  };
  for (const ch of text) {
    const b = utf8.encode(ch);
    if (chunk.length + b.length > 45) flush(); // 45 bytes → 60 base64 chars → 72-char word
    chunk.push(...b);
  }
  flush();
  return words;
}

/** Folds an ASCII header at spaces so lines stay near 78 characters. */
function foldAscii(name: string, value: string): string {
  const words = value.split(' ');
  const lines: string[] = [];
  let cur = `${name}:`;
  for (const w of words) {
    if (cur.length + 1 + w.length > 78 && cur.length > name.length + 1) {
      lines.push(cur);
      cur = ` ${w}`;
    } else cur += ` ${w}`;
  }
  lines.push(cur);
  return lines.join(CRLF);
}

/** "Name: value" with sanitizing, folding and encoded-words for non-ASCII text. */
export function encodeHeader(name: string, value: string): string {
  const v = sanitizeHeaderValue(value);
  if (isAscii(v)) return foldAscii(name, v);
  return `${name}: ${encodedWords(v).join(`${CRLF} `)}`;
}

// ───────────── addresses ─────────────

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export interface ParsedAddress {
  name?: string;
  address: string;
}

/**
 * Loose address validation: "local@domain.tld" or "Display Name <local@domain.tld>",
 * optional "mailto:" prefix. IDN domains are converted to punycode. Returns undefined when invalid.
 */
export function parseAddress(input: string): ParsedAddress | undefined {
  const s = sanitizeHeaderValue(input);
  let name: string | undefined;
  let addr = s;
  const m = /^(.*)<([^<>]+)>$/.exec(s);
  if (m) {
    name = (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() || undefined;
    addr = (m[2] ?? '').trim();
  }
  addr = addr.replace(/^mailto:/i, '');
  const at = addr.lastIndexOf('@');
  if (at <= 0 || at === addr.length - 1) return undefined;
  const local = addr.slice(0, at);
  let domain = addr.slice(at + 1).toLowerCase();
  if (!LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || local.length > 64) return undefined;
  if (!isAscii(domain)) {
    try {
      domain = new URL(`http://${domain}/`).hostname;
    } catch {
      return undefined;
    }
  }
  if (!DOMAIN_RE.test(domain)) return undefined;
  return name ? { name, address: `${local}@${domain}` } : { address: `${local}@${domain}` };
}

function formatAddress(a: ParsedAddress): string {
  if (!a.name) return a.address;
  const display = isAscii(a.name)
    ? /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/.test(a.name)
      ? a.name
      : `"${a.name.replace(/(["\\])/g, '\\$1')}"`
    : encodedWords(a.name).join(' ');
  return `${display} <${a.address}>`;
}

function addressHeader(name: string, list: string[]): string {
  const parsed = list.map((raw) => {
    const p = parseAddress(raw);
    if (!p) throw new Error(`Invalid email address: "${sanitizeHeaderValue(raw).slice(0, 100)}"`);
    return formatAddress(p);
  });
  return `${name}: ${parsed.join(`,${CRLF} `)}`;
}

// ───────────── misc ─────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 5322 date-time in UTC, e.g. "Mon, 05 Oct 2026 21:04:11 +0000". */
export function rfc5322Date(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()] ?? ''}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const MIME_TYPE_RE = /^[A-Za-z0-9!#$&^_.+-]{1,64}\/[A-Za-z0-9!#$&^_.+-]{1,64}$/;

function safeFilename(name: string): string {
  const s = sanitizeHeaderValue(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return s === '' ? 'attachment' : s;
}

function attachmentPart(a: EmlAttachment, boundary: string): string {
  const name = safeFilename(a.name);
  const type = MIME_TYPE_RE.test(a.type.trim()) ? a.type.trim().toLowerCase() : 'application/octet-stream';
  const ascii = isAscii(name);
  const fallback = ascii ? name : name.replace(/[^\x20-\x7E]/g, '_');
  const nameParam = ascii ? `"${fallback}"` : `"${encodedWords(name).join(' ')}"`;
  let disposition = `Content-Disposition: attachment;${CRLF} filename="${fallback}"`;
  if (!ascii) {
    const pct = [...utf8.encode(name)]
      .map((b) => (/[A-Za-z0-9.\-_~!$&+^`|]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`))
      .join('');
    disposition += `;${CRLF} filename*=UTF-8''${pct}`;
  }
  return [`--${boundary}`, `Content-Type: ${type};${CRLF} name=${nameParam}`, disposition, 'Content-Transfer-Encoding: base64', '', wrap76(base64(a.data))].join(CRLF);
}

export function buildEml(m: EmlMessage): string {
  const headers: string[] = [];
  if (m.from !== undefined && m.from.trim() !== '') headers.push(addressHeader('From', [m.from]));
  if (m.to.length > 0) headers.push(addressHeader('To', m.to));
  headers.push(encodeHeader('Subject', m.subject));
  headers.push(`Date: ${rfc5322Date(m.date)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('X-Unsent: 1');

  const body = quotedPrintable(m.body);
  const textHeaders = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'];
  const attachments = m.attachments ?? [];
  if (attachments.length === 0) return [...headers, ...textHeaders, '', body, ''].join(CRLF);

  // "=_" can never occur in quoted-printable or base64 output, so this boundary cannot collide with content.
  const seedBytes = utf8.encode(m.body + attachments.map((a) => `${a.name}:${a.data.length}`).join('|'));
  let h1 = fnv1a(seedBytes, 0x811c9dc5);
  let h2 = fnv1a(seedBytes, 0x01234567);
  for (const a of attachments) {
    h1 = fnv1a(a.data, h1);
    h2 = fnv1a(a.data, h2);
  }
  const boundary = `=_markwatch_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed;${CRLF} boundary="${boundary}"`,
    '',
    'This is a multi-part message in MIME format.',
    '',
    `--${boundary}`,
    ...textHeaders,
    '',
    body,
    ...attachments.map((a) => attachmentPart(a, boundary)),
    `--${boundary}--`,
    '',
  ];
  return parts.join(CRLF);
}
