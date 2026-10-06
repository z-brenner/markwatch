import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../../../src/core/draft/frontmatter';

const fm = (lines: string[], body = 'BODY'): string => ['---', ...lines, '---', body].join('\n');

describe('parseFrontMatter', () => {
  it('parses bare and quoted values, comments, and reports the body start line', () => {
    const r = parseFrontMatter(fm(['# a comment', 'id: x-1   # trailing comment', 'title: "Say \\"hi\\" \\\\ there"', '', 'url: https://a.example/#frag', 'empty:']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ id: 'x-1', title: 'Say "hi" \\ there', url: 'https://a.example/#frag', empty: '' });
    expect(r.entries.map((e) => [e.key, e.line])).toEqual([
      ['id', 3],
      ['title', 4],
      ['url', 6],
      ['empty', 7],
    ]);
    expect(r.body).toBe('BODY');
    expect(r.bodyStartLine).toBe(9);
  });

  it('keeps "#" inside quotes and handles CRLF input and a BOM', () => {
    const r = parseFrontMatter('\uFEFF---\r\nsubject: "Issue #1: {{domain}}" # c\r\n---\r\nline1\r\nline2');
    expect(r.ok && r.data.subject).toBe('Issue #1: {{domain}}');
    expect(r.ok && r.body).toBe('line1\nline2');
  });

  it('requires an opening and a closing fence', () => {
    expect(parseFrontMatter('id: x\n---\n')).toEqual({ ok: false, errors: [expect.stringContaining('line 1') as string] });
    const r = parseFrontMatter('---\nid: x\nbody');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/not closed/);
  });

  it.each([
    ['  nested: x', /indented/],
    ['- item', /lists/],
    ['no colon here', /expected "key: value"/],
    ['bad key!: x', /invalid key/],
    ['id:x', /space is required/],
    ["title: 'single'", /single-quoted/],
    ['title: [a, b]', /unsupported YAML/],
    ['title: |', /unsupported YAML/],
    ['title: "unterminated', /unterminated/],
    ['title: "bad \\n escape"', /unsupported escape/],
    ['title: "x" trailing', /after the closing quote/],
  ])('rejects %j with a line number', (line, re) => {
    const r = parseFrontMatter(fm(['id: ok', line]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^line 3: /);
    expect(r.errors[0]).toMatch(re);
  });

  it('rejects duplicate keys', () => {
    const r = parseFrontMatter(fm(['id: a', 'id: b']));
    expect(!r.ok && r.errors).toEqual(['line 3: duplicate key "id"']);
  });

  it('collects every error, not just the first', () => {
    const r = parseFrontMatter(fm(['a b', '  c: d']));
    expect(!r.ok && r.errors.length).toBe(2);
  });
});
