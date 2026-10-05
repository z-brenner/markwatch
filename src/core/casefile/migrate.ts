// Case-file migrations. MIGRATIONS[n] upgrades a parsed case.json from schema
// version n to n + 1. migrate() applies them in order until the document is at
// CASE_SCHEMA_VERSION. Future versions are refused: we never guess at a newer
// format. The result still has to pass zod validation afterwards.
//
// v1 is the first released schema, so the registry is empty. When v2 ships,
// add MIGRATIONS[1] together with a fixture-based test.

import { CASE_SCHEMA_VERSION, CaseImportError } from './schema';

export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {};

function versionOf(json: unknown): number {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new CaseImportError('schema', 'case.json must contain a JSON object');
  }
  const v = (json as Record<string, unknown>).schemaVersion;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw new CaseImportError('schema', 'case.json has a missing or invalid "schemaVersion"');
  }
  return v;
}

export function migrate(json: unknown): unknown {
  let v = versionOf(json);
  if (v > CASE_SCHEMA_VERSION) {
    throw new CaseImportError(
      'unsupported_version',
      `This case file uses schema version ${v}, which is newer than this version of Markwatch supports (${CASE_SCHEMA_VERSION}). Update Markwatch to open it.`,
    );
  }
  let doc = json;
  while (v < CASE_SCHEMA_VERSION) {
    const step = Object.hasOwn(MIGRATIONS, v) ? MIGRATIONS[v] : undefined;
    if (!step) throw new CaseImportError('unsupported_version', `No migration exists from case schema version ${v}.`);
    doc = step(doc);
    const next = versionOf(doc);
    if (next !== v + 1) throw new Error(`Migration from v${v} produced schemaVersion ${next}; expected ${v + 1}`);
    v = next;
  }
  return doc;
}
