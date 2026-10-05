// Merging a parsed template with a DraftContext and user input. Output is
// plain text. Values are inserted in a single pass from pre-scanned segments,
// so a value that itself contains "{{…}}" is never expanded.
import { isSourcedValue, type DraftContext } from './context';
import { BANNER, scanLine, scanText, type FieldRef, type ParsedTemplate, type Segment } from './template';

export { BANNER };

export interface FieldStatus {
  path: string;
  hint?: string;
  state: 'filled' | 'unfilled' | 'dismissed';
  /** Display value (lists joined with ", "). "" for an empty optional field. */
  value?: string;
  /** Where a context value came from ("RDAP rdap.verisign.com, 2026-…"); several are joined with "; ". */
  source?: string;
  userSupplied: boolean;
  /** True when every occurrence of the field is marked `| optional`. */
  optional: boolean;
}

export interface RenderResult {
  text: string;
  subject: string;
  to: string[];
  fields: FieldStatus[];
  unfilled: FieldStatus[];
  blocking: boolean;
}

interface Item {
  text: string;
  source?: string;
}

interface Resolved {
  status: FieldStatus;
  /** Context items (when not user-supplied). */
  items: Item[];
  /** True when the context value is a list rather than a scalar. */
  list: boolean;
  /** Raw user value (when user-supplied). */
  user?: string;
}

type Mode = 'body' | 'subject' | 'to';

// eslint-disable-next-line no-control-regex
const CTRL_EXCEPT_NL_TAB = /[\u0000-\u0008\u000B-\u001F\u007F\u0085\u2028\u2029]/g;

/** Guarantees the banner is the first line of the text (prepending it when absent). */
export function ensureBanner(text: string): string {
  const stripped = text.replace(/^(?:[ \t]*\r?\n)+/, '');
  const first = stripped.split(/\r?\n/, 1)[0] ?? '';
  return first.trimEnd() === BANNER ? stripped : `${BANNER}\n\n${stripped}`;
}

/** Walks a dotted path; stops at Sourced leaves. */
export function lookupPath(ctx: DraftContext, path: string): unknown {
  let node: unknown = ctx;
  for (const seg of path.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node) || isSourcedValue(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function scalarText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return undefined;
}

/** Flattens a context value into display items, carrying sources down to each item. */
function toItems(v: unknown, inherited?: string): { items: Item[]; list: boolean } {
  if (isSourcedValue(v)) return toItems(v.value, v.source ?? inherited);
  if (Array.isArray(v)) {
    const items: Item[] = [];
    for (const el of v) {
      const src = isSourcedValue(el) ? (el.source ?? inherited) : inherited;
      const t = scalarText(isSourcedValue(el) ? el.value : el);
      if (t !== undefined && t.trim() !== '') items.push(src ? { text: t, source: src } : { text: t });
    }
    return { items, list: true };
  }
  const t = scalarText(v);
  if (t === undefined || t.trim() === '') return { items: [], list: false };
  return { items: [inherited ? { text: t, source: inherited } : { text: t }], list: false };
}

function distinct(xs: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (x && !out.includes(x)) out.push(x);
  return out;
}

function resolveField(path: string, refs: FieldRef[], ctx: DraftContext, values: Record<string, string>, dismissed: Set<string>): Resolved {
  const optional = refs.every((r) => r.optional);
  const hint = refs.find((r) => r.hint !== undefined)?.hint;
  const base = { path, userSupplied: false, optional, ...(hint !== undefined ? { hint } : {}) };
  const raw = Object.prototype.hasOwnProperty.call(values, path) ? values[path] : undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const user = raw.replace(/\r\n?/g, '\n').replace(CTRL_EXCEPT_NL_TAB, ' ');
    return { status: { ...base, state: 'filled', value: user, userSupplied: true }, items: [], list: false, user };
  }
  const { items, list } = toItems(lookupPath(ctx, path));
  if (items.length > 0) {
    const sources = distinct(items.map((i) => i.source));
    const status: FieldStatus = { ...base, state: 'filled', value: items.map((i) => i.text).join(', ') };
    if (sources.length > 0) status.source = sources.join('; ');
    return { status, items, list };
  }
  if (optional) return { status: { ...base, state: 'filled', value: '' }, items: [], list };
  if (dismissed.has(path)) return { status: { ...base, state: 'dismissed' }, items: [], list };
  return { status: { ...base, state: 'unfilled' }, items: [], list };
}

function renderField(ref: FieldRef, r: Resolved, mode: Mode): string {
  const st = r.status;
  if (st.state === 'unfilled') return `⟦UNFILLED: ${ref.hint ?? st.hint ?? ref.path}⟧`;
  if (st.state === 'dismissed') return '';
  let out: string;
  if (r.user !== undefined) {
    if (ref.lines && mode === 'body') {
      out = r.user
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `- ${l}`)
        .join('\n');
    } else out = r.user;
  } else if (r.items.length === 0) out = '';
  else if (ref.lines && mode === 'body') out = r.items.map((i) => `- ${i.text}`).join('\n');
  else out = r.items.map((i) => i.text).join(', ');
  if (mode === 'to') return out.replace(/\s*\n\s*/g, ', ');
  if (mode === 'subject') return out.replace(/\s*\n\s*/g, ' ');
  return out;
}

function renderSources(order: string[], resolved: Map<string, Resolved>): string {
  const lines: string[] = [];
  for (const path of order) {
    const r = resolved.get(path);
    if (!r || r.status.state !== 'filled' || r.status.userSupplied) continue;
    const sourcedItems = r.items.filter((i) => i.source);
    if (sourcedItems.length === 0) continue;
    const srcs = distinct(sourcedItems.map((i) => i.source));
    if (srcs.length === 1 && sourcedItems.length === r.items.length) lines.push(`- ${path}: ${srcs[0] ?? ''}`);
    // Items with different sources (e.g. RDAP vs Abusix contacts): one line per item.
    else for (const i of sourcedItems) lines.push(`- ${path}: ${i.text} — ${i.source ?? ''}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- (no looked-up facts are used in this draft)';
}

function renderLine(segs: Segment[], resolved: Map<string, Resolved>, sourcesText: () => string, mode: Mode): { text: string; drop: boolean } {
  const tags = segs.filter((s) => s.kind !== 'text');
  const standalone = mode === 'body' && tags.length === 1 && segs.every((s) => s.kind !== 'text' || s.text.trim() === '');
  const leading = standalone && segs[0]?.kind === 'text' ? segs[0].text : '';
  let out = '';
  for (const s of segs) {
    if (s.kind === 'text') {
      out += s.text;
      continue;
    }
    let v: string;
    if (s.kind === 'sources') v = sourcesText();
    else {
      const r = resolved.get(s.ref.path);
      v = r ? renderField(s.ref, r, mode) : '';
    }
    if (standalone) {
      if (v === '') return { text: '', drop: true };
      // Indent continuation lines of a standalone multi-line value like its first line.
      v = v.replace(/\n/g, `\n${leading}`);
    }
    out += v;
  }
  return { text: out, drop: false };
}

export function renderTemplate(t: ParsedTemplate, ctx: DraftContext, values: Record<string, string>, dismissed: string[]): RenderResult {
  const dismissedSet = new Set(dismissed);
  const scanErrors: string[] = [];
  const toSegs = t.to !== undefined ? scanLine(t.to, 0, scanErrors) : [];
  const subjectSegs = t.subject !== undefined ? scanLine(t.subject, 0, scanErrors) : [];
  const bodyLines = scanText(t.body, 0, scanErrors);
  // ParsedTemplate values come from parseTemplate, which already rejected malformed tags.
  if (scanErrors.length > 0) throw new Error(`Template "${t.id}" has malformed merge tags: ${scanErrors.join('; ')}`);

  // Group occurrences by path in order of first appearance (to, subject, body).
  const refsByPath = new Map<string, FieldRef[]>();
  const addRefs = (segs: Segment[]): void => {
    for (const s of segs) {
      if (s.kind !== 'field') continue;
      const list = refsByPath.get(s.ref.path) ?? [];
      list.push(s.ref);
      refsByPath.set(s.ref.path, list);
    }
  };
  addRefs(toSegs);
  addRefs(subjectSegs);
  for (const l of bodyLines) addRefs(l);

  const resolved = new Map<string, Resolved>();
  for (const [path, refs] of refsByPath) resolved.set(path, resolveField(path, refs, ctx, values, dismissedSet));
  const order = [...refsByPath.keys()];
  let sourcesCache: string | undefined;
  const sourcesText = (): string => (sourcesCache ??= renderSources(order, resolved));

  const outLines: string[] = [];
  for (const segs of bodyLines) {
    const r = renderLine(segs, resolved, sourcesText, 'body');
    if (!r.drop) outLines.push(r.text);
  }
  const text = `${ensureBanner(outLines.join('\n')).replace(/\s+$/, '')}\n`;

  const subject = renderLine(subjectSegs, resolved, sourcesText, 'subject')
    .text.replace(CTRL_EXCEPT_NL_TAB, ' ')
    .replace(/[\t\n]+/g, ' ')
    .trim();
  const to = renderLine(toSegs, resolved, sourcesText, 'to')
    .text.split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const fields = order.map((p) => (resolved.get(p) as Resolved).status);
  const unfilled = fields.filter((f) => f.state === 'unfilled');
  return { text, subject, to, fields, unfilled, blocking: unfilled.length > 0 };
}
