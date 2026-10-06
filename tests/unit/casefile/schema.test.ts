import { describe, expect, it } from 'vitest';
import { newCaseState } from '../../../src/core/casefile/newCase';
import { caseFileSchema, caseStateSchema, formatZodIssues, manifestSchema } from '../../../src/core/casefile/schema';
import type { CaseState } from '../../../src/core/types';
import { RULESET, SETTINGS, buildFixture } from './fixtures';

function issues(r: { success: boolean; error?: Parameters<typeof formatZodIssues>[0] }): string {
  return r.error ? formatZodIssues(r.error) : '';
}

describe('newCaseState', () => {
  it('returns an empty, schema-valid case', () => {
    const s = newCaseState({ id: 'c1', now: '2026-10-05T12:00:00.000Z', ruleset: RULESET, settings: SETTINGS });
    const r = caseStateSchema.safeParse(s);
    expect(r.success, issues(r)).toBe(true);
    expect(s).toMatchObject({ id: 'c1', createdAt: '2026-10-05T12:00:00.000Z', domains: [], evidence: [], audit: [], inventory: [], templates: [] });
    expect(s.subject).toEqual({ marks: [], primaryDomain: '', owner: '', rights: [] });
    expect(Object.values(s.sender).every((v) => v === '')).toBe(true);
  });

  it('copies settings arrays instead of sharing them', () => {
    const settings = structuredClone(SETTINGS);
    const s = newCaseState({ id: 'c1', now: '2026-10-05T12:00:00.000Z', ruleset: RULESET, settings });
    settings.tlds.push('org');
    expect(s.settings.tlds).toEqual(SETTINGS.tlds);
  });
});

describe('caseStateSchema', () => {
  it('accepts the realistic fixture', async () => {
    const { state } = await buildFixture();
    const r = caseStateSchema.safeParse(state);
    expect(r.success, issues(r)).toBe(true);
    expect(r.data).toEqual(state);
  });

  const mutations: [string, (s: CaseState & Record<string, unknown>) => void, RegExp][] = [
    ['unknown top-level key', (s) => (s.extra = 1), /Unrecognized key/],
    ['unknown subject key', (s) => ((s.subject as unknown as Record<string, unknown>).x = 1), /subject/],
    ['unknown settings key', (s) => ((s.settings as unknown as Record<string, unknown>).x = 1), /settings/],
    ['unknown inventory key', (s) => ((s.inventory[0] as unknown as Record<string, unknown>).x = 1), /inventory\[0\]/],
    ['non-UTC timestamp', (s) => (s.createdAt = '2026-10-05T12:00:00+00:00'), /createdAt/],
    ['date-only timestamp', (s) => (s.createdAt = '2026-10-05'), /createdAt/],
    ['impossible date', (s) => (s.createdAt = '2026-13-45T99:00:00Z'), /createdAt/],
    ['uppercase sha256', (s) => (s.ruleset.sha256 = 'A'.repeat(64)), /ruleset\.sha256/],
    ['short sha256', (s) => (s.evidence[0]!.sha256 = 'abc'), /evidence\[0\]\.sha256/],
    ['bad technique', (s) => ((s.settings.techniques as string[]).push('nope')), /techniques/],
    ['bad lookup status', (s) => ((s.domains[0]!.lookups[0] as unknown as Record<string, unknown>).status = 'weird'), /lookups\[0\]/],
    ['blocked lookup without reason', (s) => delete (s.domains[0]!.lookups[1] as unknown as Record<string, unknown>).reason, /lookups\[1\]\.reason/],
    ['ok lookup without data', (s) => delete (s.domains[0]!.lookups[0] as unknown as Record<string, unknown>).data, /lookups\[0\]\.data/],
    ['extra key in lookup', (s) => ((s.domains[0]!.lookups[0] as unknown as Record<string, unknown>).evil = 1), /lookups\[0\]/],
    ['oversized raw string', (s) => ((s.domains[0]!.lookups[0] as { raw?: string }).raw = 'x'.repeat(1_000_001)), /raw/],
    ['oversized short string', (s) => (s.subject.owner = 'x'.repeat(2_001)), /subject\.owner/],
    ['negative evidence size', (s) => (s.evidence[0]!.bytes = -1), /bytes/],
    ['fractional seq', (s) => (s.audit[0]!.seq = 1.5), /audit\[0\]\.seq/],
    ['bad audit type', (s) => ((s.audit[0] as unknown as Record<string, unknown>).type = 'case.deleted'), /audit\[0\]\.type/],
    ['duplicate evidence hash', (s) => s.evidence.push({ ...s.evidence[0]! }), /Duplicate evidence/],
    ['bad classification', (s) => ((s.domains[0]!.classification as unknown as Record<string, unknown>).value = 'evil'), /classification/],
  ];
  it.each(mutations)('rejects %s', async (_label, mutate, pathRe) => {
    const { state } = await buildFixture();
    const s = structuredClone(state) as CaseState & Record<string, unknown>;
    mutate(s);
    const r = caseStateSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(issues(r)).toMatch(pathRe);
  });

  it('rejects more than 50,000 domains', async () => {
    const { state } = await buildFixture();
    const d = state.domains[1]!;
    const r = caseStateSchema.safeParse({ ...state, domains: Array.from({ length: 50_001 }, () => d) });
    expect(r.success).toBe(false);
    expect(issues(r)).toMatch(/domains/);
  });
});

describe('caseFileSchema and manifestSchema', () => {
  it('requires the exact envelope', async () => {
    const { state } = await buildFixture();
    const ok = { schemaVersion: 1, app: { name: 'Markwatch', version: '1' }, exportedAt: '2026-10-05T12:00:00Z', case: state };
    expect(caseFileSchema.safeParse(ok).success).toBe(true);
    expect(caseFileSchema.safeParse({ ...ok, schemaVersion: 2 }).success).toBe(false);
    expect(caseFileSchema.safeParse({ ...ok, app: { name: 'Other', version: '1' } }).success).toBe(false);
    expect(caseFileSchema.safeParse({ ...ok, extra: true }).success).toBe(false);
  });

  it('validates manifest hashes', () => {
    const m = { schemaVersion: 1, exportedAt: '2026-10-05T12:00:00Z', files: [{ path: 'case.json', sha256: 'a'.repeat(64), bytes: 1 }], caseJsonSha256: 'a'.repeat(64) };
    expect(manifestSchema.safeParse(m).success).toBe(true);
    expect(manifestSchema.safeParse({ ...m, caseJsonSha256: 'zz' }).success).toBe(false);
  });

  it('formats issue paths readably and caps the list', () => {
    const r = caseStateSchema.safeParse({});
    expect(r.success).toBe(false);
    const msg = formatZodIssues(r.error!, 2);
    expect(msg).toMatch(/^id: .*; createdAt: .* \(\+\d+ more\)$/);
  });
});
