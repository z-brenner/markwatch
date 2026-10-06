import { describe, expect, it } from 'vitest';
import { renderForExport, stripInternalNotes, noteFormatErrors } from '../../../src/core/draft/export';
import { parseTemplate, builtinTemplates, buildDraftContext, BANNER } from '../../../src/core/draft';
import { makeState, makeDomain } from './fixtures';

const tpl = (body: string) => {
  const r = parseTemplate(`---\nid: t\ntitle: T\nchannel: email\nclasses: cybersquatting\n---\n${body}`);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.template;
};

describe('export rendering', () => {
  it('strips notes before merging, so values typed into fields cannot change where a note ends', () => {
    const t = tpl(`${BANNER}\nA\n[INTERNAL NOTE — DELETE BEFORE SENDING: reviewed by {{input.who}}]\nB {{input.x}}\nSee Annex 1`);
    const out = renderForExport(t, {}, { 'input.who': 'Pat ] [Legal]', 'input.x': 'y]' }, []);
    expect(out.text).toBe(`${BANNER}\nA\n\nB y]\nSee Annex 1\n`);
    expect(out.removedNotes).toBe(1);
    expect(out.leak).toBe(false);
  });

  it('strips inline notes followed by real text on the same line, without swallowing later content', () => {
    const t = tpl(`${BANNER}\n[INTERNAL NOTE — DELETE BEFORE SENDING: secret strategy] Dear registrant,\nBody text\nSee [Annex 1]`);
    const out = renderForExport(t, {}, {}, []);
    expect(out.text).not.toContain('secret');
    expect(out.text).toContain('Dear registrant,');
    expect(out.text).toContain('Body text');
    expect(out.text).toContain('See [Annex 1]');
  });

  it('flags malformed notes', () => {
    expect(noteFormatErrors('[INTERNAL NOTE — DELETE BEFORE SENDING: has [nested] text]')).not.toEqual([]);
    expect(noteFormatErrors('[INTERNAL NOTE — DELETE BEFORE SENDING: never closed')).not.toEqual([]);
    expect(noteFormatErrors('a [INTERNAL NOTE — DELETE BEFORE SENDING: ok] b')).toEqual([]);
    expect(stripInternalNotes('x [INTERNAL NOTE — DELETE BEFORE SENDING: ok] y').text).toBe('x  y');
  });

  it('every built-in template exports with no note text, starting with the banner, and drops sources used only inside notes', () => {
    const state = makeState();
    const domain = makeDomain();
    const ctx = buildDraftContext(state, domain);
    for (const t of builtinTemplates()) {
      const out = renderForExport(t, ctx, {}, []);
      expect(out.leak, t.id).toBe(false);
      expect(out.text.startsWith(BANNER), t.id).toBe(true);
      expect(out.text, t.id).not.toContain('INTERNAL NOTE');
    }
  });
});
