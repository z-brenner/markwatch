// Template parsing: front-matter + body with {{merge fields}}.
//
// Merge-field grammar (kept tiny on purpose):
//   tag      := "{{" ws path ws ( "|" ws modifier ws )* "}}"
//   path     := ident ( "." ident )*        ident := [A-Za-z_][A-Za-z0-9_]*
//   modifier := "optional" | "lines" | "hint:" ws "\"" text "\""   (\" and \\ escapes)
// A tag must open and close on the same line. A stray "}}" is an error, which
// catches typos such as "{domain}}". "{{{{" has no special meaning: the first
// "{{" opens a tag and the rest must be a valid path, so it is reported.
import { CLASSIFICATIONS, type Classification, type TemplateChannel } from '../types';
import { CONTEXT_FIELDS } from './context';
import { parseFrontMatter } from './frontmatter';

export const BANNER = 'DRAFT. Attorney review required before sending.';

export const TEMPLATE_CHANNELS: readonly TemplateChannel[] = ['email', 'portal', 'internal', 'letter'];
export const FRONT_MATTER_KEYS = ['id', 'title', 'description', 'version', 'channel', 'classes', 'to', 'subject'] as const;
/** The reserved field that renders the "Sources" block. */
export const SOURCES_FIELD = 'sources';

export interface FieldRef {
  path: string;
  optional: boolean;
  hint?: string;
  lines: boolean;
  /** 1-based line number in the template source. */
  line: number;
}

export interface ParsedTemplate {
  id: string;
  title: string;
  description?: string;
  version?: string;
  channel: TemplateChannel;
  classes: Classification[];
  to?: string;
  subject?: string;
  body: string;
  builtin: boolean;
  /** Every merge-field occurrence in `to`, `subject` and the body, in that order (excluding {{sources}}). */
  fields: FieldRef[];
}

export type TemplateParseResult = { ok: true; template: ParsedTemplate; warnings: string[] } | { ok: false; errors: string[] };

export type Segment = { kind: 'text'; text: string } | { kind: 'field'; ref: FieldRef } | { kind: 'sources'; line: number };

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const PATH_RE = new RegExp(`^${IDENT}(?:\\.${IDENT})*$`);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KNOWN_PATHS = new Set(CONTEXT_FIELDS.map((f) => f.path));

/**
 * Splits one line of text into literal text and merge tags. Lines never contain
 * "\n"; `line` is the 1-based source line used in error messages.
 */
export function scanLine(text: string, line: number, errors: string[]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let lit = '';
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      const end = findTagEnd(text, i + 2);
      if (end === -1) {
        errors.push(`line ${line}: unclosed merge tag "${clip(text.slice(i))}" (tags must close with "}}" on the same line)`);
        return out;
      }
      const inner = text.slice(i + 2, end);
      const seg = parseTag(inner, line, errors);
      if (lit) out.push({ kind: 'text', text: lit });
      lit = '';
      if (seg) out.push(seg);
      i = end + 2;
      continue;
    }
    if (text.startsWith('}}', i)) {
      errors.push(`line ${line}: "}}" without a matching "{{"`);
      i += 2;
      continue;
    }
    lit += text[i] ?? '';
    i++;
  }
  if (lit) out.push({ kind: 'text', text: lit });
  return out;
}

/** Index of the closing "}}", skipping over double-quoted strings; -1 when absent. */
function findTagEnd(text: string, from: number): number {
  let inQuote = false;
  for (let j = from; j < text.length; j++) {
    const ch = text[j];
    if (inQuote) {
      if (ch === '\\') j++;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '}' && text[j + 1] === '}') return j;
  }
  return -1;
}

function parseTag(inner: string, line: number, errors: string[]): Segment | undefined {
  const parts = splitPipes(inner);
  const path = (parts[0] ?? '').trim();
  const shown = `{{${clip(inner)}}}`;
  if (path === '') {
    errors.push(`line ${line}: empty merge tag ${shown}`);
    return undefined;
  }
  if (!PATH_RE.test(path)) {
    errors.push(`line ${line}: invalid field path "${clip(path)}" in ${shown} (use letters, digits, "_" and "." only)`);
    return undefined;
  }
  const ref: FieldRef = { path, optional: false, lines: false, line };
  const seen = new Set<string>();
  let ok = true;
  for (const rawMod of parts.slice(1)) {
    const mod = rawMod.trim();
    const name = /^[A-Za-z]+/.exec(mod)?.[0] ?? '';
    if (seen.has(name)) {
      errors.push(`line ${line}: duplicate modifier "${name}" in ${shown}`);
      ok = false;
      continue;
    }
    seen.add(name);
    if (mod === 'optional') ref.optional = true;
    else if (mod === 'lines') ref.lines = true;
    else if (name === 'hint') {
      const m = /^hint[ \t]*:[ \t]*"((?:[^"\\]|\\["\\])*)"$/.exec(mod);
      if (!m) {
        errors.push(`line ${line}: malformed hint in ${shown} (expected hint: "text")`);
        ok = false;
        continue;
      }
      ref.hint = (m[1] ?? '').replace(/\\(["\\])/g, '$1');
    } else {
      errors.push(`line ${line}: unknown modifier "${clip(mod)}" in ${shown} (allowed: optional, lines, hint: "…")`);
      ok = false;
    }
  }
  if (!ok) return undefined;
  if (path === SOURCES_FIELD) {
    if (parts.length > 1) {
      errors.push(`line ${line}: {{sources}} takes no modifiers`);
      return undefined;
    }
    return { kind: 'sources', line };
  }
  return { kind: 'field', ref };
}

/** Splits on "|" outside double-quoted strings. A missing closing quote is left for the hint check to report. */
function splitPipes(inner: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let j = 0; j < inner.length; j++) {
    const ch = inner[j] ?? '';
    if (inQuote) {
      cur += ch;
      if (ch === '\\' && j + 1 < inner.length) cur += inner[++j] ?? '';
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    if (ch === '|') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** Scans a multi-line text (the body) into lines of segments. */
export function scanText(text: string, firstLine: number, errors: string[]): Segment[][] {
  return text.split('\n').map((l, idx) => scanLine(l, firstLine + idx, errors));
}

export function parseTemplate(source: string, opts: { builtin?: boolean } = {}): TemplateParseResult {
  const fm = parseFrontMatter(source);
  if (!fm.ok) return { ok: false, errors: fm.errors };
  const errors: string[] = [];
  const warnings: string[] = [];
  const lineOf = (key: string): number => fm.entries.find((e) => e.key === key)?.line ?? 1;

  for (const e of fm.entries) {
    if (!(FRONT_MATTER_KEYS as readonly string[]).includes(e.key)) warnings.push(`line ${e.line}: unknown front-matter key "${e.key}" is ignored`);
  }
  const d = fm.data;
  const id = d.id ?? '';
  const title = d.title ?? '';
  const channelRaw = d.channel ?? '';
  if (id === '') errors.push('front-matter: missing required key "id"');
  else if (!ID_RE.test(id)) errors.push(`line ${lineOf('id')}: id "${clip(id)}" must be lowercase letters, digits and "-" (max 64)`);
  if (title.trim() === '') errors.push('front-matter: missing required key "title"');
  if (channelRaw === '') errors.push('front-matter: missing required key "channel"');
  else if (!(TEMPLATE_CHANNELS as readonly string[]).includes(channelRaw)) {
    errors.push(`line ${lineOf('channel')}: channel "${clip(channelRaw)}" must be one of ${TEMPLATE_CHANNELS.join(', ')}`);
  }

  const classes: Classification[] = [];
  let badClass = false;
  for (const c of (d.classes ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(CLASSIFICATIONS as readonly string[]).includes(c)) {
      badClass = true;
      errors.push(`line ${lineOf('classes')}: unknown classification "${clip(c)}" (allowed: ${CLASSIFICATIONS.join(', ')})`);
    } else if (!classes.includes(c as Classification)) classes.push(c as Classification);
  }
  if (classes.length === 0 && !badClass) {
    warnings.push('front-matter: no "classes" listed; the template will not be offered for any classification');
  }

  // Merge tags in to / subject / body.
  const fields: FieldRef[] = [];
  const collect = (segs: Segment[]): void => {
    for (const s of segs) if (s.kind === 'field') fields.push(s.ref);
  };
  for (const key of ['to', 'subject'] as const) {
    const v = d[key];
    if (v === undefined) continue;
    const segs = scanLine(v, lineOf(key), errors);
    if (segs.some((s) => s.kind === 'sources')) errors.push(`line ${lineOf(key)}: {{sources}} cannot be used in "${key}"`);
    collect(segs);
  }
  const bodyLines = scanText(fm.body, fm.bodyStartLine, errors);
  for (const segs of bodyLines) collect(segs);

  if (errors.length > 0) return { ok: false, errors };

  const firstContent = fm.body.split('\n').find((l) => l.trim() !== '');
  if (firstContent?.trimEnd() !== BANNER) {
    warnings.push(`body: the first line is not the banner "${BANNER}"; it will be added when the draft is rendered`);
  }
  const channel = channelRaw as TemplateChannel;
  if (channel === 'email' && (d.to ?? '').trim() === '') warnings.push('front-matter: email template has no "to"');
  if (channel === 'email' && (d.subject ?? '').trim() === '') warnings.push('front-matter: email template has no "subject"');

  const unknownPaths = new Set<string>();
  for (const f of fields) {
    if (!KNOWN_PATHS.has(f.path) && !f.path.startsWith('input.') && !unknownPaths.has(f.path)) {
      unknownPaths.add(f.path);
      warnings.push(`line ${f.line}: "${f.path}" is not a known context field; it will be treated as user input (name user-input fields "input.*")`);
    }
  }

  const template: ParsedTemplate = {
    id,
    title: title.trim(),
    channel,
    classes,
    body: fm.body,
    builtin: opts.builtin ?? false,
    fields,
  };
  if (d.description !== undefined && d.description !== '') template.description = d.description;
  if (d.version !== undefined && d.version !== '') template.version = d.version;
  if (d.to !== undefined) template.to = d.to;
  if (d.subject !== undefined) template.subject = d.subject;
  return { ok: true, template, warnings };
}
