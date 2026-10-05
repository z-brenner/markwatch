import { describe, expect, it } from 'vitest';
import { BANNER, parseTemplate } from '../../../src/core/draft/template';

function src(front: string[], body: string[]): string {
  return ['---', ...front, '---', ...body].join('\n');
}
const FRONT = ['id: t-1', 'title: Test', 'channel: email', 'classes: phishing_malware, copied_content', 'to: "{{registrar.abuseEmail}}"', 'subject: "Report: {{domain}}"'];

describe('parseTemplate: valid templates', () => {
  it('parses front-matter and collects field refs with absolute line numbers', () => {
    const r = parseTemplate(
      src(FRONT, [BANNER, '', 'Domain: {{ domain }}', '{{input.notes | optional | hint: "Say \\"why\\" | here"}}', '{{evidence.list | lines}}', '{{sources}}']),
      { builtin: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    const t = r.template;
    expect(t).toMatchObject({ id: 't-1', title: 'Test', channel: 'email', classes: ['phishing_malware', 'copied_content'], builtin: true, to: '{{registrar.abuseEmail}}', subject: 'Report: {{domain}}' });
    expect(t.fields).toEqual([
      { path: 'registrar.abuseEmail', optional: false, lines: false, line: 6 },
      { path: 'domain', optional: false, lines: false, line: 7 },
      { path: 'domain', optional: false, lines: false, line: 11 },
      { path: 'input.notes', optional: true, lines: false, hint: 'Say "why" | here', line: 12 },
      { path: 'evidence.list', optional: false, lines: true, line: 13 },
    ]);
  });

  it('keeps description and version and dedupes classes', () => {
    const r = parseTemplate(src([...FRONT.slice(0, 3), 'classes: for_sale, for_sale', 'description: d', 'version: 3'], [BANNER]));
    expect(r.ok && r.template).toMatchObject({ description: 'd', version: '3', classes: ['for_sale'], builtin: false });
  });

  it('treats single braces and "}" text as literal', () => {
    const r = parseTemplate(src(FRONT, [BANNER, 'JSON-ish { "a": 1 } and a } brace']));
    expect(r.ok).toBe(true);
  });
});

describe('parseTemplate: warnings', () => {
  it('warns on unknown keys, missing banner, missing classes, missing to/subject, unknown paths', () => {
    const r = parseTemplate(src(['id: t-2', 'title: T', 'channel: email', 'author: me'], ['Hello {{registar.name}} {{input.ok}}']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.warnings.join('\n');
    expect(w).toMatch(/line 5: unknown front-matter key "author"/);
    expect(w).toMatch(/first line is not the banner/);
    expect(w).toMatch(/no "classes"/);
    expect(w).toMatch(/no "to"/);
    expect(w).toMatch(/no "subject"/);
    expect(w).toMatch(/line 7: "registar.name" is not a known context field/);
    expect(w).not.toMatch(/input\.ok/);
  });

  it('accepts the banner after leading blank lines', () => {
    const r = parseTemplate(src(FRONT, ['', '', BANNER]));
    expect(r.ok && r.warnings).toEqual([]);
  });
});

describe('parseTemplate: errors', () => {
  it('reports missing id, title and channel', () => {
    const r = parseTemplate(src(['classes: phishing_malware'], [BANNER]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/"id"/), expect.stringMatching(/"title"/), expect.stringMatching(/"channel"/)]) as unknown);
  });

  it('rejects an invalid channel, id and classification with line numbers', () => {
    const r = parseTemplate(src(['id: Bad_ID', 'title: T', 'channel: fax', 'classes: phishing, for_sale'], [BANNER]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      expect.stringMatching(/^line 2: id "Bad_ID"/),
      expect.stringMatching(/^line 4: channel "fax"/),
      expect.stringMatching(/^line 5: unknown classification "phishing"/),
    ]);
  });

  it.each([
    ['Hello {{domain', /line 10: unclosed merge tag/],
    ['Hello {domain}}', /line 10: "}}" without a matching "{{"/],
    ['Hello {{}}', /line 10: empty merge tag/],
    ['Hello {{ two words }}', /line 10: invalid field path/],
    ['Hello {{a..b}}', /line 10: invalid field path/],
    ['Hello {{{{domain}}', /line 10: invalid field path/],
    ['Hello {{domain | upper}}', /line 10: unknown modifier "upper"/],
    ['Hello {{domain | optional | optional}}', /line 10: duplicate modifier "optional"/],
    ['Hello {{domain | hint: unquoted}}', /line 10: malformed hint/],
    ['Hello {{domain | hint: "open}}', /line 10: unclosed merge tag/],
    ['Hello {{sources | lines}}', /line 10: \{\{sources\}\} takes no modifiers/],
  ])('reports malformed tag %j', (line, re) => {
    const r = parseTemplate(src(FRONT, [BANNER, line]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(re);
  });

  it('reports tag errors in the front-matter at the key line, and forbids {{sources}} there', () => {
    const r = parseTemplate(src(['id: t', 'title: T', 'channel: email', 'subject: "Hi {{domain"', 'to: "{{sources}}"'], [BANNER]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/line 5: unclosed merge tag/);
    expect(r.errors.join('\n')).toMatch(/line 6: \{\{sources\}\} cannot be used in "to"/);
  });

  it('a tag may not span lines', () => {
    const r = parseTemplate(src(FRONT, [BANNER, '{{domain', '}}']));
    expect(!r.ok && r.errors.join('\n')).toMatch(/line 10: unclosed[\s\S]*line 11: "}}" without/);
  });

  it('propagates front-matter errors', () => {
    expect(parseTemplate('no front matter').ok).toBe(false);
  });
});
