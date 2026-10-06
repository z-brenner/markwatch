// A deliberately tiny, strict subset of YAML front-matter:
//
//   ---
//   key: value            # comment
//   key: "quoted \"value\""
//   ---
//   body…
//
// One `key: value` pair per line, no nesting, no lists, no multi-line values,
// no anchors/tags/flow collections. Anything outside the subset is an error
// (with a line number) rather than a guess, because imported templates are
// untrusted input and a silently misread `to:` would address mail wrongly.

export interface FrontMatterEntry {
  key: string;
  value: string;
  /** 1-based line number in the original source. */
  line: number;
}

export type FrontMatterResult =
  | {
      ok: true;
      entries: FrontMatterEntry[];
      data: Record<string, string>;
      /** Everything after the closing `---` line, with LF line endings. */
      body: string;
      /** 1-based source line number of the first body line. */
      bodyStartLine: number;
    }
  | { ok: false; errors: string[] };

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Normalizes CRLF/CR to LF and strips a leading byte-order mark. */
export function normalizeNewlines(source: string): string {
  return source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function parseFrontMatter(source: string): FrontMatterResult {
  const lines = normalizeNewlines(source).split('\n');
  const errors: string[] = [];

  if ((lines[0] ?? '').trimEnd() !== '---') {
    return { ok: false, errors: ['line 1: template must start with a front-matter block opened by "---"'] };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trimEnd() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { ok: false, errors: ['line 1: front-matter block is not closed by a "---" line'] };

  const entries: FrontMatterEntry[] = [];
  const data: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 1; i < close; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^[ \t]/.test(raw)) {
      errors.push(`line ${lineNo}: indented lines are not supported (no nesting in front-matter)`);
      continue;
    }
    if (trimmed.startsWith('- ') || trimmed === '-') {
      errors.push(`line ${lineNo}: lists are not supported; use a comma-separated value`);
      continue;
    }
    const colon = raw.indexOf(':');
    if (colon === -1) {
      errors.push(`line ${lineNo}: expected "key: value"`);
      continue;
    }
    const key = raw.slice(0, colon).trim();
    if (!KEY_RE.test(key)) {
      errors.push(`line ${lineNo}: invalid key "${key}"`);
      continue;
    }
    const rest = raw.slice(colon + 1);
    if (rest !== '' && !/^[ \t]/.test(rest)) {
      errors.push(`line ${lineNo}: a space is required after "${key}:"`);
      continue;
    }
    const parsed = parseValue(rest.trim());
    if (!parsed.ok) {
      errors.push(`line ${lineNo}: ${parsed.error}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`line ${lineNo}: duplicate key "${key}"`);
      continue;
    }
    data[key] = parsed.value;
    entries.push({ key, value: parsed.value, line: lineNo });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries, data: { ...data }, body: lines.slice(close + 1).join('\n'), bodyStartLine: close + 2 };
}

type ValueResult = { ok: true; value: string } | { ok: false; error: string };

function parseValue(text: string): ValueResult {
  if (text === '') return { ok: true, value: '' };
  if (text.startsWith('"')) return parseQuoted(text);
  const first = text[0] ?? '';
  if (first === "'") return { ok: false, error: 'single-quoted values are not supported; use double quotes' };
  if ('[{|>&*!%@`'.includes(first)) {
    return { ok: false, error: `unsupported YAML syntax "${first}"; wrap the value in double quotes` };
  }
  // A "#" starts a comment only when preceded by whitespace (as in YAML).
  const comment = text.search(/[ \t]#/);
  const value = (comment === -1 ? text : text.slice(0, comment)).trim();
  return { ok: true, value };
}

function parseQuoted(text: string): ValueResult {
  let out = '';
  let i = 1;
  for (; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '"' || next === '\\') {
        out += next;
        i++;
        continue;
      }
      return { ok: false, error: `unsupported escape "\\${next ?? ''}" in quoted value (only \\" and \\\\ are allowed)` };
    }
    if (ch === '"') break;
    out += ch;
  }
  if (i >= text.length) return { ok: false, error: 'unterminated double-quoted value' };
  const after = text.slice(i + 1).trim();
  if (after !== '' && !after.startsWith('#')) return { ok: false, error: 'unexpected text after the closing quote' };
  return { ok: true, value: out };
}
