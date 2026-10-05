import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate } from '../../../src/core/casefile/migrate';
import { CASE_SCHEMA_VERSION, CaseImportError } from '../../../src/core/casefile/schema';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof CaseImportError ? e.code : 'not a CaseImportError';
  }
  return undefined;
}

describe('migrate', () => {
  afterEach(() => {
    for (const k of Object.keys(MIGRATIONS)) delete MIGRATIONS[Number(k)];
  });

  it('ships with an empty registry for v1', () => {
    expect(CASE_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('returns a current-version document unchanged', () => {
    const doc = { schemaVersion: 1, x: 1 };
    expect(migrate(doc)).toBe(doc);
  });

  it('refuses an unknown future version', () => {
    expect(codeOf(() => migrate({ schemaVersion: 2 }))).toBe('unsupported_version');
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/99/);
  });

  it('refuses an old version with no registered migration', () => {
    expect(codeOf(() => migrate({ schemaVersion: 0 }))).toBe('unsupported_version');
  });

  it.each([[null], [[]], ['x'], [{}], [{ schemaVersion: '1' }], [{ schemaVersion: -1 }], [{ schemaVersion: 1.5 }]])('rejects a malformed document %j', (doc) => {
    expect(codeOf(() => migrate(doc))).toBe('schema');
  });

  it('applies registered migrations in order (fake v0 → v1)', () => {
    const calls: number[] = [];
    MIGRATIONS[0] = (old) => {
      calls.push(0);
      const o = old as { schemaVersion: number; caseData: unknown };
      return { schemaVersion: 1, case: o.caseData, migratedFrom: 0 };
    };
    expect(migrate({ schemaVersion: 0, caseData: { id: 'x' } })).toEqual({ schemaVersion: 1, case: { id: 'x' }, migratedFrom: 0 });
    expect(calls).toEqual([0]);
  });

  it('fails loudly when a migration does not advance the version', () => {
    MIGRATIONS[0] = (old) => old;
    expect(() => migrate({ schemaVersion: 0 })).toThrow(/expected 1/);
  });
});
