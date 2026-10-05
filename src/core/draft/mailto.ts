// mailto: links (RFC 6068). Many mail clients truncate long mailto URLs, so
// links over MAILTO_MAX characters are refused with an explanation instead of
// producing a silently shortened draft. mailto cannot carry attachments.
import { parseAddress } from './eml';

export const MAILTO_MAX = 1900;

export function buildMailto(m: { to: string[]; subject: string; body: string }): { ok: true; url: string } | { ok: false; length: number; reason: string } {
  const addrs: string[] = [];
  for (const raw of m.to) {
    const p = parseAddress(raw);
    if (!p) return { ok: false, length: 0, reason: `"${raw.slice(0, 100)}" is not a valid email address.` };
    addrs.push(encodeURIComponent(p.address).replace(/%40/g, '@'));
  }
  // eslint-disable-next-line no-control-regex
  const subject = m.subject.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  // RFC 6068 §5: line breaks in the body are encoded as %0D%0A.
  const body = m.body.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const params: string[] = [];
  if (subject !== '') params.push(`subject=${encodeURIComponent(subject)}`);
  if (body !== '') params.push(`body=${encodeURIComponent(body)}`);
  const url = `mailto:${addrs.join(',')}${params.length ? `?${params.join('&')}` : ''}`;
  if (url.length > MAILTO_MAX) {
    return {
      ok: false,
      length: url.length,
      reason: `The mailto link would be ${url.length} characters, over the ${MAILTO_MAX}-character limit at which mail clients may truncate it. Download the .eml file or copy the text instead.`,
    };
  }
  return { ok: true, url };
}
