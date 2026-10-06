import { describe, expect, it } from 'vitest';
import { prepareExport } from '../../../src/core/draft/export';

describe('prepareExport', () => {
  it('removes internal notes (single and multi-line), keeps the banner, counts placeholders', () => {
    const src = [
      'DRAFT. Attorney review required before sending.',
      '',
      '[INTERNAL NOTE — DELETE BEFORE SENDING: strategy that must never reach the other side]',
      'Dear registrant,',
      '[INTERNAL NOTE — DELETE BEFORE SENDING: spans',
      'two lines]',
      '[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: x]',
      '',
      '',
      '',
      'Regards',
    ].join('\n');
    const out = prepareExport(src);
    expect(out.removedNotes).toBe(2);
    expect(out.placeholders).toBe(1);
    expect(out.text).not.toContain('INTERNAL NOTE');
    expect(out.text).not.toContain('strategy');
    expect(out.text.startsWith('DRAFT. Attorney review required before sending.')).toBe(true);
    expect(out.text).not.toMatch(/\n{3,}/);
  });

  it('a "]" typed into a merge value inside a note does not leave note text behind', () => {
    const out = prepareExport('A\n[INTERNAL NOTE — DELETE BEFORE SENDING: reviewed by Pat [Legal] Smith]\nB');
    expect(out.text).toBe('A\n\nB\n');
    expect(out.removedNotes).toBe(1);
  });
});
