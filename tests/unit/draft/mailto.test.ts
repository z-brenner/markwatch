import { describe, expect, it } from 'vitest';
import { buildMailto, MAILTO_MAX } from '../../../src/core/draft/mailto';

describe('buildMailto', () => {
  it('percent-encodes subject and body, with CRLF line breaks and %20 for spaces', () => {
    const r = buildMailto({ to: ['abuse@registrar.example', 'x+tag@host.example'], subject: 'Abuse report: a&b=c?', body: 'Line 1\nLine 2 — ü #' });
    expect(r).toEqual({
      ok: true,
      url: 'mailto:abuse@registrar.example,x%2Btag@host.example?subject=Abuse%20report%3A%20a%26b%3Dc%3F&body=Line%201%0D%0ALine%202%20%E2%80%94%20%C3%BC%20%23',
    });
  });

  it('round-trips through URL decoding', () => {
    const body = 'DRAFT.\r\nSecond line & more';
    const r = buildMailto({ to: ['a@b.example'], subject: 'Sübject', body });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = new URLSearchParams(r.url.slice(r.url.indexOf('?') + 1));
    expect(q.get('subject')).toBe('Sübject');
    expect(q.get('body')).toBe(body);
  });

  it('strips control characters from the subject and omits empty params', () => {
    expect(buildMailto({ to: ['a@b.example'], subject: 'x\r\nBcc: y', body: '' })).toEqual({ ok: true, url: 'mailto:a@b.example?subject=x%20Bcc%3A%20y' });
    expect(buildMailto({ to: [], subject: '', body: '' })).toEqual({ ok: true, url: 'mailto:' });
  });

  it('refuses links longer than MAILTO_MAX with the length and a reason', () => {
    const r = buildMailto({ to: ['a@b.example'], subject: 's', body: 'x'.repeat(MAILTO_MAX) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.length).toBeGreaterThan(MAILTO_MAX);
    expect(r.reason).toMatch(/1900-character limit/);
    expect(r.reason).toMatch(/\.eml/);
  });

  it('accepts a link of exactly MAILTO_MAX characters', () => {
    const prefix = 'mailto:a@b.example?body=';
    const r = buildMailto({ to: ['a@b.example'], subject: '', body: 'x'.repeat(MAILTO_MAX - prefix.length) });
    expect(r.ok && r.url.length).toBe(MAILTO_MAX);
  });

  it('rejects invalid addresses', () => {
    const r = buildMailto({ to: ['⟦UNFILLED: x⟧'], subject: 's', body: 'b' });
    expect(r.ok).toBe(false);
  });
});
