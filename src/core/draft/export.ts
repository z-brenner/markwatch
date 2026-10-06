// Produces the text that leaves the app. Internal drafting notes are for the
// user only. They are removed from the TEMPLATE before merging, not from the
// merged text: inside a template a note cannot contain "[" or "]" (enforced
// for built-in and imported templates), so the match is exact, and nothing a
// user types into a merge field can change where a note ends.
import { renderTemplate, type RenderResult } from './merge';
import type { ParsedTemplate } from './template';
import type { DraftContext } from './context';

export const NOTE_PREFIX = '[INTERNAL NOTE — DELETE BEFORE SENDING';
const NOTE_RE = /\[INTERNAL NOTE — DELETE BEFORE SENDING[^[\]]*\]/g;
const PLACEHOLDER = /\[PLACEHOLDER LEGAL LANGUAGE[^\]]*\]/g;

export function stripInternalNotes(source: string): { text: string; removed: number } {
  let removed = 0;
  const text = source.replace(NOTE_RE, () => {
    removed++;
    return '';
  });
  return { text, removed };
}

/** Format problems that would make note stripping unreliable. Empty means OK. */
export function noteFormatErrors(source: string): string[] {
  const errors: string[] = [];
  const prefixes = source.split(NOTE_PREFIX).length - 1;
  const { text, removed } = stripInternalNotes(source);
  if (removed !== prefixes) errors.push(`Every "${NOTE_PREFIX}…" note must end with "]" and must not contain "[" or "]" inside it (${prefixes - removed} malformed).`);
  if (/INTERNAL NOTE/.test(text)) errors.push('"INTERNAL NOTE" text must only appear as a well-formed note.');
  return errors;
}

function tidy(text: string): string {
  return `${text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export interface ExportRender extends Pick<RenderResult, 'subject' | 'to'> {
  text: string;
  removedNotes: number;
  placeholders: number;
  /** True if note text would still leave the app; exports must be refused. */
  leak: boolean;
}

/** Renders the template for export: notes stripped from the source, then merged. */
export function renderForExport(t: ParsedTemplate, ctx: DraftContext, values: Record<string, string>, dismissed: string[]): ExportRender {
  const body = stripInternalNotes(t.body);
  const subject = t.subject !== undefined ? stripInternalNotes(t.subject).text : undefined;
  const r = renderTemplate({ ...t, body: body.text, ...(subject !== undefined ? { subject } : {}) }, ctx, values, dismissed);
  const text = tidy(r.text);
  return {
    text,
    subject: r.subject,
    to: r.to,
    removedNotes: body.removed,
    placeholders: (text.match(PLACEHOLDER) ?? []).length,
    leak: /INTERNAL NOTE/.test(text) || /INTERNAL NOTE/.test(r.subject),
  };
}
