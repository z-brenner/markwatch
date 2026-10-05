import { describe, expect, it } from 'vitest';
import type { DraftContext } from '../../../src/core/draft/context';
import { BANNER, ensureBanner, renderTemplate } from '../../../src/core/draft/merge';
import { parseTemplate, type ParsedTemplate } from '../../../src/core/draft/template';

function tpl(body: string[], front: string[] = []): ParsedTemplate {
  const r = parseTemplate(['---', 'id: t', 'title: T', 'channel: email', 'classes: phishing_malware', ...front, '---', ...body].join('\n'));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.template;
}

const ctx: DraftContext = {
  domain: 'acme-login.com',
  registrar: {
    name: { value: 'Example Registrar', source: 'RDAP rdap.verisign.com, 2026-10-05T21:04:11Z' },
    abuseEmail: { value: ['abuse@reg.example', 'abuse2@reg.example'], source: 'RDAP rdap.verisign.com, 2026-10-05T21:04:11Z' },
  },
  host: {
    abuseEmail: [
      { value: 'abuse@host.example', source: 'RDAP rdap.arin.net, 2026-10-05T21:05:02Z' },
      { value: 'abuse@abusix.example', source: 'Abusix Contact DB (cloudflare-dns.com), 2026-10-05T21:05:03Z' },
    ],
  },
  mark: { rights: [] as string[], owner: 'Acme' },
  evidence: { list: ['a.png — SHA-256 aaa', 'b.html — SHA-256 bbb'] },
  score: { total: 0 },
  registrant: { redacted: true },
  empty: '',
  nil: null,
};

describe('renderTemplate', () => {
  it('fills from context, marks unfilled with hint or path, and blocks', () => {
    const r = renderTemplate(tpl([BANNER, 'D: {{domain}}', 'R: {{registrar.name}}', 'M: {{mark.rights | hint: "Enter mark rights"}}', 'X: {{input.why}}']), ctx, {}, []);
    expect(r.text).toBe(`${BANNER}\nD: acme-login.com\nR: Example Registrar\nM: ⟦UNFILLED: Enter mark rights⟧\nX: ⟦UNFILLED: input.why⟧\n`);
    expect(r.blocking).toBe(true);
    expect(r.unfilled.map((f) => f.path)).toEqual(['mark.rights', 'input.why']);
    expect(r.fields.find((f) => f.path === 'registrar.name')).toEqual({
      path: 'registrar.name',
      state: 'filled',
      value: 'Example Registrar',
      source: 'RDAP rdap.verisign.com, 2026-10-05T21:04:11Z',
      userSupplied: false,
      optional: false,
    });
  });

  it('treats undefined, null, empty string and empty array as unfilled; 0 and false as filled', () => {
    const r = renderTemplate(tpl([BANNER, '{{empty}}|{{nil}}|{{missing.path}}|{{mark.rights}}|{{score.total}}|{{registrant.redacted}}']), ctx, {}, []);
    expect(r.text.split('\n')[1]).toBe('⟦UNFILLED: empty⟧|⟦UNFILLED: nil⟧|⟦UNFILLED: missing.path⟧|⟦UNFILLED: mark.rights⟧|0|yes');
    expect(r.unfilled).toHaveLength(4);
  });

  it('user values win over context values and fill user-input fields', () => {
    const r = renderTemplate(tpl([BANNER, '{{registrar.name}} / {{input.why}}']), ctx, { 'registrar.name': 'Typed Registrar', 'input.why': 'Because' }, []);
    expect(r.text).toContain('Typed Registrar / Because');
    expect(r.blocking).toBe(false);
    const f = r.fields.find((x) => x.path === 'registrar.name');
    expect(f).toMatchObject({ state: 'filled', userSupplied: true, value: 'Typed Registrar' });
    expect(f?.source).toBeUndefined();
  });

  it('whitespace-only user values do not count as filled', () => {
    const r = renderTemplate(tpl([BANNER, '{{input.why}}']), ctx, { 'input.why': '   ' }, []);
    expect(r.blocking).toBe(true);
  });

  it('dismissed fields render empty, are reported as dismissed, and do not block', () => {
    const r = renderTemplate(tpl([BANNER, 'Why: {{input.why}}.']), ctx, {}, ['input.why']);
    expect(r.text).toContain('Why: .');
    expect(r.blocking).toBe(false);
    expect(r.fields).toEqual([{ path: 'input.why', state: 'dismissed', userSupplied: false, optional: false }]);
  });

  it('a dismissal does not hide a field that has a value', () => {
    const r = renderTemplate(tpl([BANNER, '{{domain}}']), ctx, {}, ['domain']);
    expect(r.fields[0]?.state).toBe('filled');
    expect(r.text).toContain('acme-login.com');
  });

  it('optional fields render empty without blocking; standalone empty lines are dropped', () => {
    const r = renderTemplate(tpl([BANNER, 'A: {{input.x | optional}}!', '  {{input.y | optional}}', 'end']), ctx, {}, []);
    expect(r.text).toBe(`${BANNER}\nA: !\nend\n`);
    expect(r.blocking).toBe(false);
    expect(r.fields.map((f) => [f.path, f.state, f.value, f.optional])).toEqual([
      ['input.x', 'filled', '', true],
      ['input.y', 'filled', '', true],
    ]);
  });

  it('a field required anywhere is required everywhere', () => {
    const r = renderTemplate(tpl([BANNER, '{{input.x | optional}} {{input.x}}']), ctx, {}, []);
    expect(r.unfilled.map((f) => f.path)).toEqual(['input.x']);
  });

  it('joins arrays with ", " by default and renders "- " lines with | lines, keeping indentation', () => {
    const r = renderTemplate(tpl([BANNER, 'E: {{evidence.list}}', '  {{evidence.list | lines}}', '{{input.urls | lines}}']), ctx, { 'input.urls': 'https://a.example/1\n\n  https://a.example/2  ' }, []);
    expect(r.text).toBe(
      `${BANNER}\nE: a.png — SHA-256 aaa, b.html — SHA-256 bbb\n  - a.png — SHA-256 aaa\n  - b.html — SHA-256 bbb\n- https://a.example/1\n- https://a.example/2\n`,
    );
  });

  it('renders the sources block for used, looked-up values only (per-item sources, Abusix credited)', () => {
    // registrar.* has sources in the context but is not used by this template, so it is not listed.
    const t = tpl([BANNER, 'Sources:', '{{sources}}', '{{domain}} {{host.abuseEmail}} {{input.x}}'], ['to: "{{registrar.abuseEmail}}"']);
    const r = renderTemplate(t, ctx, { 'input.x': 'typed' }, []);
    const lines = r.text.trimEnd().split('\n');
    const at = lines.indexOf('Sources:');
    expect(lines.slice(at + 1, at + 4)).toEqual([
      '- registrar.abuseEmail: RDAP rdap.verisign.com, 2026-10-05T21:04:11Z',
      '- host.abuseEmail: abuse@host.example — RDAP rdap.arin.net, 2026-10-05T21:05:02Z',
      '- host.abuseEmail: abuse@abusix.example — Abusix Contact DB (cloudflare-dns.com), 2026-10-05T21:05:03Z',
    ]);
    expect(r.text).not.toContain('registrar.name');
    expect(r.text).not.toContain('- domain:');
    expect(r.text).not.toContain('input.x');
  });

  it('sources block lists nothing for user-overridden values and says so when empty', () => {
    const t = tpl([BANNER, '{{registrar.name}}', '{{sources}}']);
    const r = renderTemplate(t, ctx, { 'registrar.name': 'X' }, []);
    expect(r.text).toContain('- (no looked-up facts are used in this draft)');
  });

  it('counts fields in subject and to, and splits recipients', () => {
    const t = tpl([BANNER, 'body'], ['to: "{{registrar.abuseEmail}}; {{input.cc}}"', 'subject: "Abuse: {{domain}} {{input.ref}}"']);
    const r = renderTemplate(t, ctx, {}, []);
    expect(r.to).toEqual(['abuse@reg.example', 'abuse2@reg.example', '⟦UNFILLED: input.cc⟧']);
    expect(r.subject).toBe('Abuse: acme-login.com ⟦UNFILLED: input.ref⟧');
    expect(r.unfilled.map((f) => f.path)).toEqual(['input.cc', 'input.ref']);
    expect(r.fields.map((f) => f.path)).toEqual(['registrar.abuseEmail', 'input.cc', 'domain', 'input.ref']);
    const filled = renderTemplate(t, ctx, { 'input.cc': 'cc@x.example', 'input.ref': 'line1\nline2' }, []);
    expect(filled.blocking).toBe(false);
    expect(filled.subject).toBe('Abuse: acme-login.com line1 line2');
    expect(filled.to).toEqual(['abuse@reg.example', 'abuse2@reg.example', 'cc@x.example']);
  });

  it('does not resolve inherited properties or walk into strings', () => {
    const r = renderTemplate(tpl([BANNER, '{{constructor}}|{{toString}}|{{domain.length}}|{{registrar.name.value}}']), ctx, {}, []);
    expect(r.unfilled.map((f) => f.path)).toEqual(['constructor', 'toString', 'domain.length', 'registrar.name.value']);
  });

  it('never expands merge syntax inside values', () => {
    const r = renderTemplate(tpl([BANNER, '{{input.x}}']), ctx, { 'input.x': '{{domain}}' }, []);
    expect(r.text).toContain('{{domain}}');
  });

  it('strips control characters from user values but keeps line breaks', () => {
    const r = renderTemplate(tpl([BANNER, 'X: {{input.x}}']), ctx, { 'input.x': 'a\u0007b\r\nc' }, []);
    expect(r.text).toContain('X: a b\nc');
  });

  it('guarantees the banner as the first line even when the template omits it', () => {
    const t = tpl(['', 'Hello {{domain}}']);
    const r = renderTemplate(t, ctx, {}, []);
    expect(r.text.split('\n')[0]).toBe(BANNER);
    expect(r.text).toBe(`${BANNER}\n\nHello acme-login.com\n`);
    // A field that would render on the first line cannot displace the banner.
    const r2 = renderTemplate(tpl(['{{input.first}}', BANNER]), ctx, { 'input.first': 'Not the banner' }, []);
    expect(r2.text.split('\n')[0]).toBe(BANNER);
  });

  it('ensureBanner is idempotent', () => {
    expect(ensureBanner(`${BANNER}\nx`)).toBe(`${BANNER}\nx`);
    expect(ensureBanner('\n\nx')).toBe(`${BANNER}\n\nx`);
    expect(ensureBanner(ensureBanner('x'))).toBe(`${BANNER}\n\nx`);
  });
});
