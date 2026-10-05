import { describe, expect, it } from 'vitest';
import { base64, buildEml, encodeHeader, parseAddress, quotedPrintable, rfc5322Date, sanitizeHeaderValue } from '../../../src/core/draft/eml';

const DATE = new Date('2026-10-05T21:04:11Z');

/** Splits a message into header lines (unfolded) and body. */
function split(msg: string): { headers: Map<string, string>; body: string } {
  const idx = msg.indexOf('\r\n\r\n');
  const head = msg.slice(0, idx).replace(/\r\n[ \t]/g, ' ');
  const headers = new Map<string, string>();
  for (const line of head.split('\r\n')) {
    const c = line.indexOf(':');
    headers.set(line.slice(0, c).toLowerCase(), line.slice(c + 1).trim());
  }
  return { headers, body: msg.slice(idx + 4) };
}

function decodeQp(s: string): string {
  const joined = s.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=') {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(joined.charCodeAt(i));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function decodeWords(s: string): string {
  // RFC 2047 §6.2: whitespace between adjacent encoded-words is ignored; elsewhere it is kept.
  return s
    .replace(/\?=\s+(?==\?UTF-8\?B\?)/g, '?=')
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_m, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

describe('buildEml', () => {
  const body = 'DRAFT. Attorney review required before sending.\n\nLine with = sign and trailing space \nÜnïcödé — ✓\n' + 'x'.repeat(200);
  const msg = buildEml({ from: 'Pat Example <pat@acme.example>', to: ['abuse@registrar.example', 'Höst Abuse <abuse@host.example>'], subject: 'Abuse report: acme-login.com', body, date: DATE });

  it('uses CRLF everywhere (no bare LF or CR)', () => {
    expect(msg).not.toMatch(/[^\r]\n/);
    expect(msg).not.toMatch(/\r[^\n]/);
    expect(msg.endsWith('\r\n')).toBe(true);
  });

  it('has the draft headers', () => {
    const { headers } = split(msg);
    expect(headers.get('x-unsent')).toBe('1');
    expect(headers.get('mime-version')).toBe('1.0');
    expect(headers.get('date')).toBe('Mon, 05 Oct 2026 21:04:11 +0000');
    expect(headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(headers.get('content-transfer-encoding')).toBe('quoted-printable');
    expect(headers.get('from')).toBe('Pat Example <pat@acme.example>');
    expect(decodeWords(headers.get('to') ?? '')).toBe('abuse@registrar.example, Höst Abuse <abuse@host.example>');
  });

  it('keeps every line within 998 octets and the body within 76 columns', () => {
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    for (const line of split(msg).body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('quoted-printable body round-trips (with CRLF line endings)', () => {
    expect(decodeQp(split(msg).body.replace(/\r\n$/, ''))).toBe(body.replace(/\n/g, '\r\n'));
    expect(split(msg).body).toContain('space=20');
  });

  it('encodes a non-ASCII subject as RFC 2047 encoded-words', () => {
    const subject = 'Rapport d’abus : acmé-login.com — ünïcödé ✓ '.repeat(3).trim();
    const m = buildEml({ to: [], subject, body: 'x', date: DATE });
    const { headers } = split(m);
    const raw = headers.get('subject') ?? '';
    expect(raw).toMatch(/^=\?UTF-8\?B\?/);
    expect(raw).not.toMatch(/[^\x20-\x7E]/);
    expect(decodeWords(raw)).toBe(subject);
    for (const w of raw.split(' ')) expect(w.length).toBeLessThanOrEqual(75);
  });

  it('neutralizes header injection in subject, from and to', () => {
    const m = buildEml({ from: 'x\r\nBcc: evil@x.example <pat@acme.example>', to: ['a@b.example'], subject: 'x\r\nBcc: evil@x', body: 'hi', date: DATE });
    const lines = m.slice(0, m.indexOf('\r\n\r\n')).split('\r\n');
    expect(lines.some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(lines).toContain('Subject: x Bcc: evil@x');
    expect(m).not.toMatch(/\r\nBcc:/i);
    expect(() => buildEml({ to: ['a@b.example\r\nBcc: evil@x.example'], subject: 's', body: 'b', date: DATE })).toThrow(/Invalid email address/);
  });

  it('rejects invalid addresses and omits From when absent', () => {
    expect(() => buildEml({ to: ['not-an-address'], subject: 's', body: 'b', date: DATE })).toThrow(/Invalid email address/);
    const m = buildEml({ to: ['a@b.example'], subject: 's', body: 'b', date: DATE });
    expect(split(m).headers.has('from')).toBe(false);
  });

  it('builds multipart/mixed with base64 attachments (76 columns) and RFC 2231 filenames', () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    const m = buildEml({
      to: ['a@b.example'],
      subject: 'with files',
      body: 'See attached.',
      date: DATE,
      attachments: [
        { name: 'screenshot.png', type: 'image/png', data },
        { name: 'capture ü "1"\r\n.pdf', type: 'bad type\r\nX: y', data: new Uint8Array([1, 2, 3]) },
      ],
    });
    const { headers, body } = split(m);
    const boundary = /boundary="([^"]+)"/.exec(headers.get('content-type') ?? '')?.[1] ?? '';
    expect(headers.get('content-type')).toMatch(/^multipart\/mixed;/);
    expect(boundary).toMatch(/^=_markwatch_[0-9a-f]{16}$/);
    const parts = body.split(`--${boundary}`);
    expect(parts.at(-1)).toBe('--\r\n');
    const [, text, png, pdf] = parts;
    expect(text).toContain('Content-Type: text/plain; charset=utf-8');
    expect(decodeQp((text ?? '').split('\r\n\r\n')[1]!.replace(/\r\n$/, ''))).toBe('See attached.');

    const pngSplit = split((png ?? '').replace(/^\r\n/, ''));
    expect(pngSplit.headers.get('content-type')).toBe('image/png; name="screenshot.png"');
    expect(pngSplit.headers.get('content-disposition')).toBe('attachment; filename="screenshot.png"');
    expect(pngSplit.headers.get('content-transfer-encoding')).toBe('base64');
    const b64Lines = pngSplit.body.replace(/\r\n$/, '').split('\r\n');
    for (const l of b64Lines) expect(l.length).toBeLessThanOrEqual(76);
    expect(b64Lines[0]?.length).toBe(76);
    expect(new Uint8Array(Buffer.from(b64Lines.join(''), 'base64'))).toEqual(data);

    const pdfSplit = split((pdf ?? '').replace(/^\r\n/, ''));
    expect(pdfSplit.headers.get('content-type')).toMatch(/^application\/octet-stream; name="=\?UTF-8\?B\?/);
    const disp = pdfSplit.headers.get('content-disposition') ?? '';
    expect(disp).toContain(`filename="capture _ _1_ .pdf"`);
    expect(disp).toContain(`filename*=UTF-8''capture%20%C3%BC%20_1_%20.pdf`);
    // Each attachment header line is sanitized: no injected header.
    expect(m).not.toMatch(/\r\nX: y/);
  });

  it('is deterministic', () => {
    const a = { to: ['a@b.example'], subject: 's', body: 'b', date: DATE, attachments: [{ name: 'f.txt', type: 'text/plain', data: new Uint8Array([65]) }] };
    expect(buildEml(a)).toBe(buildEml(a));
  });
});

describe('eml helpers', () => {
  it('base64 matches Node for all padding cases', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      expect(base64(new TextEncoder().encode(s))).toBe(Buffer.from(s).toString('base64'));
    }
  });

  it('quotedPrintable encodes =, trailing whitespace, and non-ASCII; soft-breaks at 76', () => {
    expect(quotedPrintable('a=b \nc\t')).toBe('a=3Db=20\r\nc=09');
    expect(quotedPrintable('é')).toBe('=C3=A9');
    const long = quotedPrintable('é'.repeat(40));
    for (const l of long.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    expect(decodeQp(long)).toBe('é'.repeat(40));
  });

  it('sanitizeHeaderValue strips CR, LF, NUL, C1 and Unicode line separators', () => {
    expect(sanitizeHeaderValue('a\r\nb\u0000c\u0085d e')).toBe('a b c d e');
  });

  it('encodeHeader folds long ASCII headers at spaces', () => {
    const h = encodeHeader('Subject', 'word '.repeat(30));
    for (const l of h.split('\r\n')) expect(l.length).toBeLessThanOrEqual(78);
    expect(h.replace(/\r\n /g, ' ')).toBe(`Subject: ${'word '.repeat(30).trim()}`);
  });

  it('parseAddress validates loosely and punycodes IDN domains', () => {
    expect(parseAddress('abuse@registrar.example')).toEqual({ address: 'abuse@registrar.example' });
    expect(parseAddress('mailto:Abuse@Registrar.EXAMPLE')).toEqual({ address: 'Abuse@registrar.example' });
    expect(parseAddress('"Doe, Jane" <jane@x.example>')).toEqual({ name: 'Doe, Jane', address: 'jane@x.example' });
    expect(parseAddress('abuse@bücher.example')).toEqual({ address: 'abuse@xn--bcher-kva.example' });
    for (const bad of ['', 'x', '@x.example', 'a@', 'a@b', 'a b@c.example', 'a@b..example', '.a@b.example', 'a@-b.example', 'ä@b.example']) {
      expect(parseAddress(bad), bad).toBeUndefined();
    }
  });

  it('rfc5322Date formats in UTC', () => {
    expect(rfc5322Date(new Date('2026-01-02T03:04:05Z'))).toBe('Fri, 02 Jan 2026 03:04:05 +0000');
  });
});
