import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATE_IDS } from '../../../src/core/types';
import { buildDraftContext, CONTEXT_FIELDS } from '../../../src/core/draft/context';
import { BANNER, renderTemplate } from '../../../src/core/draft/merge';
import { builtinTemplates, MAX_TEMPLATE_BYTES, resolveTemplates, validateImportedTemplate } from '../../../src/core/draft/registry';
import { parseTemplate } from '../../../src/core/draft/template';
import { makeDomain, makeState } from './fixtures';

const IMPORTED_OVERRIDE = `---
id: registrar-abuse
title: Registrar abuse report (counsel-approved)
channel: email
classes: phishing_malware
to: "{{registrar.abuseEmail}}"
subject: "Abuse: {{domain}}"
---
${BANNER}
Approved text about {{domain}}.
`;

describe('builtinTemplates', () => {
  const builtins = builtinTemplates();

  it('loads all 7 built-ins in canonical order, excluding README.md', () => {
    expect(builtins.map((t) => t.id)).toEqual([...BUILTIN_TEMPLATE_IDS]);
    expect(builtins.every((t) => t.builtin)).toBe(true);
  });

  it('returns copies, so callers cannot mutate the cache', () => {
    builtins[0]!.classes.push('unrelated');
    expect(builtinTemplates()[0]!.classes).not.toContain('unrelated');
  });

  it('only the compliance note is offered for authorized_noncompliant, and nothing outbound for fair_use', () => {
    const fresh = builtinTemplates();
    expect(fresh.filter((t) => t.classes.includes('authorized_noncompliant')).map((t) => t.id)).toEqual(['compliance-note']);
    expect(fresh.find((t) => t.id === 'compliance-note')?.classes).toEqual(['authorized_noncompliant']);
    expect(fresh.filter((t) => t.classes.includes('fair_use') || t.classes.includes('unrelated'))).toEqual([]);
  });

  it('every built-in renders against a real context with the banner first and no rendering artifacts', () => {
    const ctx = buildDraftContext(makeState(), makeDomain(), { now: new Date('2026-10-05T22:00:00Z') });
    for (const t of builtinTemplates()) {
      const r = renderTemplate(t, ctx, {}, []);
      expect(r.text.split('\n')[0], t.id).toBe(BANNER);
      expect(r.text, t.id).not.toMatch(/undefined|\[object Object\]|NaN/);
      // Filling every unfilled field unblocks the draft.
      const values = Object.fromEntries(r.unfilled.map((f) => [f.path, `value for ${f.path}`]));
      const filled = renderTemplate(t, ctx, values, []);
      expect(filled.blocking, t.id).toBe(false);
      expect(filled.text, t.id).not.toContain('⟦UNFILLED');
      // Dismissing every unfilled field also unblocks it.
      expect(renderTemplate(t, ctx, {}, r.unfilled.map((f) => f.path)).blocking, t.id).toBe(false);
    }
  });

  it('every field in a built-in is either a documented context path or an input.* field', () => {
    const known = new Set(CONTEXT_FIELDS.map((f) => f.path));
    for (const t of builtinTemplates()) {
      for (const f of t.fields) expect(f.path.startsWith('input.') || known.has(f.path), `${t.id}: ${f.path}`).toBe(true);
    }
  });
});

describe('validateImportedTemplate', () => {
  it('accepts a valid import and warns that it overrides a built-in', () => {
    const r = validateImportedTemplate(IMPORTED_OVERRIDE, 'approved.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.template.builtin).toBe(false);
    expect(r.warnings).toEqual(['approved.md: replaces the built-in template "registrar-abuse" for this case']);
  });

  it('accepts an import without the banner, with a warning, and rendering still adds the banner', () => {
    const src = IMPORTED_OVERRIDE.replace(`${BANNER}\n`, '').replace('id: registrar-abuse', 'id: custom-one');
    const r = validateImportedTemplate(src, 'custom.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join('\n')).toMatch(/not the banner/);
    expect(renderTemplate(r.template, { domain: 'x.example' }, {}, []).text.split('\n')[0]).toBe(BANNER);
  });

  it.each([
    ['invalid classification', IMPORTED_OVERRIDE.replace('classes: phishing_malware', 'classes: phishing'), /unknown classification "phishing"/],
    ['invalid channel', IMPORTED_OVERRIDE.replace('channel: email', 'channel: sms'), /channel "sms"/],
    ['missing id', IMPORTED_OVERRIDE.replace('id: registrar-abuse\n', ''), /missing required key "id"/],
    ['malformed tag', IMPORTED_OVERRIDE.replace('{{domain}}.', '{{domain.'), /line 10: unclosed merge tag/],
    ['no front-matter', 'just text', /front-matter/],
    ['NUL bytes', `${IMPORTED_OVERRIDE}\u0000`, /NUL/],
  ])('rejects %s', (_label, src, re) => {
    const r = validateImportedTemplate(src, 'bad.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(re);
    expect(r.errors.every((e) => e.startsWith('bad.md: '))).toBe(true);
  });

  it('rejects files over 200 KB (measured in UTF-8 bytes)', () => {
    const big = IMPORTED_OVERRIDE + 'é'.repeat(MAX_TEMPLATE_BYTES / 2);
    const r = validateImportedTemplate(big, 'big.md');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/limit is 204800 bytes/);
  });
});

describe('resolveTemplates', () => {
  const builtins = builtinTemplates();
  const parse = (s: string) => {
    const r = parseTemplate(s);
    if (!r.ok) throw new Error(r.errors.join());
    return r.template;
  };

  it('imported templates override built-ins by id, in the built-in position', () => {
    const override = parse(IMPORTED_OVERRIDE);
    const out = resolveTemplates(builtins, [override]);
    expect(out.map((t) => t.id)).toEqual([...BUILTIN_TEMPLATE_IDS]);
    expect(out[0]).toBe(override);
    expect(out[0]?.title).toBe('Registrar abuse report (counsel-approved)');
  });

  it('new ids follow the built-ins in import order; the last import of an id wins', () => {
    const a1 = parse(IMPORTED_OVERRIDE.replace('id: registrar-abuse', 'id: zeta').replace('(counsel-approved)', 'v1'));
    const b = parse(IMPORTED_OVERRIDE.replace('id: registrar-abuse', 'id: alpha'));
    const a2 = parse(IMPORTED_OVERRIDE.replace('id: registrar-abuse', 'id: zeta').replace('(counsel-approved)', 'v2'));
    const out = resolveTemplates(builtins, [a1, b, a2]);
    expect(out.map((t) => t.id)).toEqual([...BUILTIN_TEMPLATE_IDS, 'zeta', 'alpha']);
    expect(out.at(-2)?.title).toMatch(/v2/);
  });

  it('does not mutate its inputs', () => {
    const imported = [parse(IMPORTED_OVERRIDE)];
    const before = builtins.map((t) => t.id);
    resolveTemplates(builtins, imported);
    expect(builtins.map((t) => t.id)).toEqual(before);
    expect(imported).toHaveLength(1);
  });
});
