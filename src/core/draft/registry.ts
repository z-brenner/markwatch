// Built-in templates (bundled from templates/*.md at build time) and runtime
// imports of counsel-approved templates. An imported template with the same
// id as a built-in replaces it: that is how a legal team swaps placeholder
// language for its own approved text.
//
// One rule is absolute: anything that can be drafted for an authorized partner
// (the compliance-note id, or any template listing authorized_noncompliant)
// must be an internal, neutral note. Imports that break it are rejected, so a
// threat template can never be attached to that class.
import { BUILTIN_TEMPLATE_IDS } from '../types';
import { parseTemplate, type ParsedTemplate } from './template';

export const MAX_TEMPLATE_BYTES = 200 * 1024;

/** The compliance-note id: the only template routing offers for authorized_noncompliant. */
export const COMPLIANCE_NOTE_ID = 'compliance-note';

/**
 * Legal-threat vocabulary that may not appear anywhere in a template drafted
 * for an authorized partner (matched case-insensitively as substrings).
 */
export const COMPLIANCE_FORBIDDEN: readonly string[] = ['infringe', 'demand', 'cease', 'liable', 'violation', 'legal action', 'lawsuit', 'damages'];

/**
 * Errors for a template that would be drafted for an authorized partner and is
 * not an internal, neutral note; [] when the rule does not apply or is met.
 */
export function complianceRuleErrors(t: ParsedTemplate): string[] {
  if (t.id !== COMPLIANCE_NOTE_ID && !t.classes.includes('authorized_noncompliant')) return [];
  const why = t.id === COMPLIANCE_NOTE_ID ? `templates with id "${COMPLIANCE_NOTE_ID}"` : 'templates for "authorized_noncompliant"';
  const errors: string[] = [];
  if (t.channel !== 'internal') errors.push(`${why} must use channel: internal (found "${t.channel}")`);
  if (t.to !== undefined) errors.push(`${why} must not have a "to" field: they are internal notes, never sent to the partner`);
  if (t.classes.length !== 1 || t.classes[0] !== 'authorized_noncompliant') {
    errors.push(`${why} must list exactly one class, authorized_noncompliant (found "${t.classes.join(', ')}")`);
  }
  const text = [t.title, t.description ?? '', t.subject ?? '', t.body].join('\n').toLowerCase();
  const found = COMPLIANCE_FORBIDDEN.filter((w) => text.includes(w));
  if (found.length > 0) errors.push(`${why} must stay neutral; remove the legal-threat wording: ${found.map((w) => `"${w}"`).join(', ')}`);
  return errors;
}

const RAW: Record<string, string> = import.meta.glob<string>('../../../templates/*.md', { query: '?raw', import: 'default', eager: true });

let cache: ParsedTemplate[] | undefined;

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Parses the bundled templates. A built-in that fails to parse is a build defect and throws. */
export function builtinTemplates(): ParsedTemplate[] {
  if (!cache) {
    const out: ParsedTemplate[] = [];
    for (const [path, source] of Object.entries(RAW)) {
      if (fileName(path).toLowerCase() === 'readme.md') continue;
      const r = parseTemplate(source, { builtin: true });
      if (!r.ok) throw new Error(`Built-in template ${fileName(path)} is invalid: ${r.errors.join('; ')}`);
      const ruleErrors = complianceRuleErrors(r.template);
      if (ruleErrors.length > 0) throw new Error(`Built-in template ${fileName(path)} is invalid: ${ruleErrors.join('; ')}`);
      out.push(r.template);
    }
    const rank = (id: string): number => {
      const i = (BUILTIN_TEMPLATE_IDS as readonly string[]).indexOf(id);
      return i === -1 ? BUILTIN_TEMPLATE_IDS.length : i;
    };
    out.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    cache = out;
  }
  return cache.map((t) => ({ ...t, classes: [...t.classes], fields: t.fields.map((f) => ({ ...f })) }));
}

export function validateImportedTemplate(source: string, name: string): { ok: true; template: ParsedTemplate; warnings: string[] } | { ok: false; errors: string[] } {
  const label = name.trim() === '' ? 'template' : name;
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_TEMPLATE_BYTES) {
    return { ok: false, errors: [`${label}: file is ${bytes} bytes; the limit is ${MAX_TEMPLATE_BYTES} bytes (200 KB)`] };
  }
  if (source.includes('\u0000')) return { ok: false, errors: [`${label}: file contains NUL bytes; templates must be plain UTF-8 text`] };
  const r = parseTemplate(source, { builtin: false });
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => `${label}: ${e}`) };
  const ruleErrors = complianceRuleErrors(r.template);
  if (ruleErrors.length > 0) return { ok: false, errors: ruleErrors.map((e) => `${label}: ${e}`) };
  const warnings = r.warnings.map((w) => `${label}: ${w}`);
  const builtinIds = new Set<string>([...BUILTIN_TEMPLATE_IDS, ...builtinTemplates().map((t) => t.id)]);
  if (builtinIds.has(r.template.id)) {
    warnings.push(`${label}: replaces the built-in template "${r.template.id}" for this case`);
  }
  return { ok: true, template: r.template, warnings };
}

/**
 * Imported templates override built-ins with the same id, in the built-in's position.
 * Among imports sharing an id, the last one wins, at the position of the first.
 * Imports with new ids follow the built-ins in import order.
 */
export function resolveTemplates(builtins: ParsedTemplate[], imported: ParsedTemplate[]): ParsedTemplate[] {
  const latestImport = new Map<string, ParsedTemplate>();
  for (const t of imported) latestImport.set(t.id, t);
  const out: ParsedTemplate[] = [];
  const seen = new Set<string>();
  for (const b of builtins) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(latestImport.get(b.id) ?? b);
  }
  for (const t of imported) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(latestImport.get(t.id) ?? t);
  }
  return out;
}
