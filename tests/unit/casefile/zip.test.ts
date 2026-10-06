import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../../../src/core/casefile/audit';
import { CaseImportError, type Manifest } from '../../../src/core/casefile/schema';
import { CaseExportError, compactUtc, evidencePath, exportCaseZip, importCaseZip, sanitizeFileName } from '../../../src/core/casefile/zip';
import type { CaseState } from '../../../src/core/types';
import { sha256Hex } from '../../../src/core/util';
import { APP, EVIDENCE_A, EVIDENCE_B, FIXED_NOW, buildFixture, editCaseJson, rezip } from './fixtures';

async function exported() {
  const { state, evidence } = await buildFixture();
  const out = await exportCaseZip(state, evidence, APP, FIXED_NOW);
  return { state, evidence, ...out };
}

async function expectImportError(p: Promise<unknown>, code: CaseImportError['code'], message?: RegExp): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected CaseImportError(${code})`).toBeInstanceOf(CaseImportError);
  expect((err as CaseImportError).code).toBe(code);
  if (message) expect((err as Error).message).toMatch(message);
}

/** Calls `patch` with a DataView and the offset of the central-directory header for `name`. */
function patchCentral(bytes: Uint8Array, name: string, patch: (v: DataView, off: number) => void): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  let e = out.length - 22;
  while (v.getUint32(e, true) !== 0x06054b50) e--;
  const count = v.getUint16(e + 10, true);
  let o = v.getUint32(e + 16, true);
  for (let i = 0; i < count; i++) {
    const nl = v.getUint16(o + 28, true);
    const n = strFromU8(out.subarray(o + 46, o + 46 + nl));
    if (n === name) {
      patch(v, o);
      return out;
    }
    o += 46 + nl + v.getUint16(o + 30, true) + v.getUint16(o + 32, true);
  }
  throw new Error(`entry ${name} not found`);
}

/** Replaces every occurrence of an ASCII string with another of the same length (local + central headers). */
function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const out = bytes.slice();
  const f = strToU8(from);
  const t = strToU8(to);
  for (let i = 0; i + f.length <= out.length; i++) {
    if (f.every((b, j) => out[i + j] === b)) out.set(t, i);
  }
  return out;
}

describe('sanitizeFileName and naming', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['my file (1).png', 'my_file_1_.png'],
    ['../../etc/passwd', '_etc_passwd'],
    ['..\\..\\win.ini', '_win.ini'],
    ['.hidden', 'hidden'],
    ['...', 'file'],
    ['', 'file'],
    ['Résumé.pdf', 'Resume.pdf'],
    ['日本語.txt', '_.txt'],
    ['a/b\\c:d', 'a_b_c_d'],
    ['trailing.', 'trailing'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('caps length at 100 and keeps the extension', () => {
    const s = sanitizeFileName(`${'x'.repeat(300)}.html`);
    expect(s).toHaveLength(100);
    expect(s.endsWith('.html')).toBe(true);
    expect(sanitizeFileName('y'.repeat(300))).toHaveLength(100);
  });

  it('never produces separators or leading dots', () => {
    for (const n of ['/abs', '\\abs', '.', '..', './x', 'a/../b', '\u0000x', '\u202Eexe.txt']) {
      const s = sanitizeFileName(n);
      expect(s).toMatch(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/);
    }
  });

  it('builds evidence paths and compact timestamps', () => {
    expect(evidencePath({ sha256: 'a'.repeat(64), name: 'shot 1.png' })).toBe(`evidence/${'a'.repeat(64)}-shot_1.png`);
    expect(compactUtc(FIXED_NOW)).toBe('20261005T143015Z');
  });
});

describe('exportCaseZip', () => {
  it('writes the documented layout and file name', async () => {
    const { bytes, fileName, manifest, state } = await exported();
    expect(fileName).toBe('markwatch-case-Acme_Widgets-20261005T143015Z.zip');
    const files = unzipSync(bytes);
    const shaA = state.evidence[0]!.sha256;
    const shaB = state.evidence[1]!.sha256;
    expect(Object.keys(files)).toEqual([
      'README.txt',
      'case.json',
      'manifest.json',
      `evidence/${shaA}-acme-login_copy_.html`,
      `evidence/${shaB}-Resume_screenshot.png`,
    ]);
    const caseText = strFromU8(files['case.json']!);
    expect(caseText).toContain('\n  "schemaVersion": 1,');
    const caseJson = JSON.parse(caseText) as Record<string, unknown>;
    expect(caseJson).toMatchObject({ schemaVersion: 1, app: { name: 'Markwatch', version: '0.1.0', buildHash: 'abc1234' }, exportedAt: '2026-10-05T14:30:15.123Z' });

    const m = JSON.parse(strFromU8(files['manifest.json']!)) as Manifest;
    expect(m).toEqual(manifest);
    expect(m.caseJsonSha256).toBe(await sha256Hex(new Uint8Array(files['case.json']!)));
    expect(m.files.map((f) => f.path)).toEqual(['case.json', 'README.txt', `evidence/${shaA}-acme-login_copy_.html`, `evidence/${shaB}-Resume_screenshot.png`]);
    for (const f of m.files) {
      expect(f.sha256).toBe(await sha256Hex(new Uint8Array(files[f.path]!)));
      expect(f.bytes).toBe(files[f.path]!.length);
    }
    expect(m.missingEvidence).toBeUndefined();

    const readme = strFromU8(files['README.txt']!);
    expect(readme).toMatch(/SHA-256/);
    expect(readme).toMatch(/UTC/);
    expect(readme).toMatch(/local|clock/);
    expect(readme).toMatch(/does not give legal advice/);
  });

  it('falls back to "case" when there is no mark and omits buildHash when not given', async () => {
    const { state, evidence } = await buildFixture();
    state.subject.marks = [];
    const { fileName, bytes } = await exportCaseZip(state, evidence, { version: '1.0.0' }, FIXED_NOW);
    expect(fileName).toBe('markwatch-case-case-20261005T143015Z.zip');
    const caseJson = JSON.parse(strFromU8(unzipSync(bytes)['case.json']!)) as { app: Record<string, unknown> };
    expect(caseJson.app).toEqual({ name: 'Markwatch', version: '1.0.0' });
  });

  it('is deterministic for a fixed `now`', async () => {
    const a = await exported();
    const b = await exported();
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const { state, evidence } = await buildFixture();
    const c = await exportCaseZip(state, evidence, APP, new Date(FIXED_NOW.getTime() + 1000));
    expect(Buffer.from(a.bytes).equals(Buffer.from(c.bytes))).toBe(false);
  });

  describe('timezone independence', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });
    it('produces the same bytes regardless of the local timezone', async () => {
      process.env.TZ = 'UTC';
      const a = await exported();
      process.env.TZ = 'Pacific/Kiritimati';
      const b = await exported();
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    });
  });

  it('refuses a missing evidence blob unless allowed', async () => {
    const { state, evidence } = await buildFixture();
    const shaB = state.evidence[1]!.sha256;
    evidence.delete(shaB);
    await expect(exportCaseZip(state, evidence, APP, FIXED_NOW)).rejects.toMatchObject({ name: 'CaseExportError', code: 'evidence_missing' });

    const { bytes, manifest } = await exportCaseZip(state, evidence, APP, FIXED_NOW, { allowMissingEvidence: true });
    expect(manifest.missingEvidence).toEqual([shaB]);
    expect(strFromU8(unzipSync(bytes)['README.txt']!)).toMatch(/Missing evidence/);
    const imported = await importCaseZip(bytes);
    expect(imported.evidence.has(shaB)).toBe(false);
    expect(imported.warnings.join('\n')).toMatch(/not in the archive/);
  });

  it('refuses a blob that does not match its hash or recorded size', async () => {
    const { state, evidence } = await buildFixture();
    const shaA = state.evidence[0]!.sha256;
    evidence.set(shaA, strToU8('something else'));
    await expect(exportCaseZip(state, evidence, APP, FIXED_NOW)).rejects.toMatchObject({ code: 'evidence_mismatch' });

    const fresh = await buildFixture();
    fresh.state.evidence[0]!.bytes += 1;
    await expect(exportCaseZip(fresh.state, fresh.evidence, APP, FIXED_NOW)).rejects.toThrow(/bytes/);
  });

  it('refuses a state that import would reject, naming the path', async () => {
    const { state, evidence } = await buildFixture();
    state.domains[0]!.lookups[0]!.at = 'yesterday';
    const err = await exportCaseZip(state, evidence, APP, FIXED_NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaseExportError);
    expect((err as Error).message).toMatch(/case\.domains\[0\]\.lookups\[0\]\.at/);
  });

  it('validates the JSON form: an ok lookup whose data is undefined cannot be exported', async () => {
    const { state, evidence } = await buildFixture();
    (state.domains[0]!.lookups[0] as { data: unknown }).data = undefined;
    await expect(exportCaseZip(state, evidence, APP, FIXED_NOW)).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('importCaseZip round trip', () => {
  it('restores identical state, evidence bytes and a valid audit chain', async () => {
    const { state, bytes } = await exported();
    const r = await importCaseZip(bytes);
    expect(r.state).toStrictEqual(state);
    expect(r.warnings).toEqual([]);
    expect(r.audit).toEqual({ ok: true, warnings: [] });
    expect(r.state.audit).toHaveLength(5);
    expect(r.evidence.size).toBe(2);
    expect(r.evidence.get(state.evidence[0]!.sha256)).toEqual(EVIDENCE_A);
    expect(r.evidence.get(state.evidence[1]!.sha256)).toEqual(EVIDENCE_B);
    // Every lookup status variant survived.
    expect(r.state.domains.flatMap((d) => d.lookups.map((l) => l.status)).sort()).toEqual(['blocked', 'blocked', 'manual', 'not_found', 'ok']);
  });

  it('re-export of an import is byte-identical', async () => {
    const { bytes } = await exported();
    const r = await importCaseZip(bytes);
    const again = await exportCaseZip(r.state, r.evidence, APP, FIXED_NOW);
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('round-trips a brand-new empty case', async () => {
    const { state } = await buildFixture();
    const empty: CaseState = { ...state, domains: [], evidence: [], audit: [], templates: [], inventory: [] };
    const { bytes } = await exportCaseZip(empty, new Map(), APP, FIXED_NOW);
    expect((await importCaseZip(bytes)).state).toStrictEqual(empty);
  });

  it('accepts directory entries and warns about unexpected or unreferenced files without inflating them', async () => {
    const { bytes } = await exported();
    const extra = rezip(bytes, (f) => {
      f['evidence/'] = new Uint8Array(0);
      f['notes.txt'] = strToU8('hello');
      f[`evidence/${'d'.repeat(64)}-orphan.bin`] = strToU8('orphan');
    });
    const r = await importCaseZip(extra);
    expect(r.evidence.size).toBe(2);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/unexpected file.*notes\.txt/);
    expect(r.warnings[1]).toMatch(/not referenced.*orphan\.bin/);
  });

  it('warns (not fatal) when referenced evidence is missing from the archive', async () => {
    const { bytes, state } = await exported();
    const p = evidencePath(state.evidence[1]!);
    const r = await importCaseZip(rezip(bytes, (f) => delete f[p]));
    expect(r.evidence.size).toBe(1);
    expect(r.warnings.join('\n')).toMatch(/listed in case\.json but its file is not in the archive/);
    expect(r.warnings.join('\n')).toMatch(/manifest\.json lists/);
  });

  it('warns when manifest.json is absent', async () => {
    const { bytes } = await exported();
    const r = await importCaseZip(rezip(bytes, (f) => delete f['manifest.json']));
    expect(r.warnings).toEqual([expect.stringMatching(/no manifest\.json/)]);
    expect(r.evidence.size).toBe(2);
  });
});

describe('importCaseZip tamper detection', () => {
  it('rejects an evidence file with one changed byte', async () => {
    const { bytes, state } = await exported();
    const p = evidencePath(state.evidence[1]!);
    const tampered = rezip(bytes, (f) => {
      const data = f[p]!.slice();
      data[100] = data[100]! ^ 0x01;
      f[p] = data;
    });
    await expectImportError(importCaseZip(tampered), 'evidence_mismatch', /does not match its SHA-256/);
  });

  it('rejects a stored (uncompressed) evidence entry with a byte flipped in the raw archive', async () => {
    const { state, evidence } = await buildFixture();
    const p = evidencePath(state.evidence[0]!);
    const files = unzipSync((await exportCaseZip(state, evidence, APP, FIXED_NOW)).bytes);
    const stored = zipSync({ ...files, [p]: [files[p]!, { level: 0 }] });
    const marker = strToU8('Fake Acme');
    let at = -1;
    for (let i = 0; i < stored.length && at < 0; i++) if (marker.every((b, j) => stored[i + j] === b)) at = i;
    expect(at).toBeGreaterThan(0);
    const flipped = stored.slice();
    flipped[at] = 'f'.charCodeAt(0);
    await expectImportError(importCaseZip(flipped), 'evidence_mismatch');
  });

  it('rejects evidence whose manifest hash disagrees', async () => {
    const { bytes, state } = await exported();
    const p = evidencePath(state.evidence[0]!);
    const tampered = rezip(bytes, (f) => {
      const m = JSON.parse(strFromU8(f['manifest.json']!)) as Manifest;
      m.files.find((x) => x.path === p)!.sha256 = 'e'.repeat(64);
      f['manifest.json'] = strToU8(JSON.stringify(m));
    });
    await expectImportError(importCaseZip(tampered), 'evidence_mismatch', /manifest/);
  });

  it('flags an edited audit payload (not fatal) at the right entry', async () => {
    const { bytes } = await exported();
    const tampered = editCaseJson(bytes, (j) => {
      j.case.audit[3]!.payload.value = 'fair_use';
    });
    const r = await importCaseZip(tampered);
    expect(r.audit).toMatchObject({ ok: false, brokenAt: 4 });
    expect(r.warnings.some((w) => /audit log is broken at entry 4/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /modified after export/.test(w))).toBe(true);
  });

  it('flags a deleted audit entry', async () => {
    const { bytes } = await exported();
    const r = await importCaseZip(editCaseJson(bytes, (j) => j.case.audit.splice(1, 1)));
    expect(r.audit).toMatchObject({ ok: false, brokenAt: 2 });
  });

  it('flags reordered audit entries', async () => {
    const { bytes } = await exported();
    const r = await importCaseZip(
      editCaseJson(bytes, (j) => {
        const a = j.case.audit;
        [a[2], a[3]] = [a[3]!, a[2]!];
      }),
    );
    expect(r.audit).toMatchObject({ ok: false, brokenAt: 3 });
    expect(await verifyAuditChain(r.state.audit)).toEqual(r.audit);
  });

  it('notices a case.json edit that leaves the chain intact via the manifest hash', async () => {
    const { bytes } = await exported();
    const r = await importCaseZip(editCaseJson(bytes, (j) => (j.case.subject.owner = 'Someone Else')));
    expect(r.audit.ok).toBe(true);
    expect(r.warnings).toEqual([expect.stringMatching(/modified after export/)]);
  });
});

describe('importCaseZip hostile input', () => {
  it.each([
    ['empty input', new Uint8Array(0)],
    ['plain text', strToU8('this is definitely not a zip file, just some text')],
    ['a PNG header', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)])],
    ['a truncated zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array<number>(40).fill(0)])],
  ])('rejects %s as not_zip', async (_label, data) => {
    await expectImportError(importCaseZip(data), 'not_zip');
  });

  it('rejects a corrupted central directory as not_zip', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(bytes.slice(0, Math.floor(bytes.length / 2))), 'not_zip');
  });

  it.each([['../x'], ['/etc/x'], ['evidence\\x'], ['evidence/../../x'], ['C:/x'], ['a//b'], ['./case.json'], ['bad\u0000name']])('rejects the unsafe path %j', async (name) => {
    const { bytes } = await exported();
    const hostile = rezip(bytes, (f) => (f[name] = strToU8('x')));
    await expectImportError(importCaseZip(hostile), 'path');
  });

  it('rejects duplicate entry names', async () => {
    const zip = zipSync({ 'case.json': strToU8('{}'), 'case.jsoo': strToU8('{"a":1}') });
    await expectImportError(importCaseZip(replaceAscii(zip, 'case.jsoo', 'case.json')), 'path', /Duplicate/);
  });

  it('rejects too many entries', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(bytes, { maxEntries: 4 }), 'too_many_entries');
    const many = rezip(bytes, (f) => {
      for (let i = 0; i < 30; i++) f[`junk/${i}.txt`] = strToU8('x');
    });
    await expectImportError(importCaseZip(many, { maxEntries: 20 }), 'too_many_entries');
  });

  it('rejects a ZIP larger than maxZipBytes before parsing', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(bytes, { maxZipBytes: bytes.length - 1 }), 'too_large');
  });

  it('rejects an entry over the uncompressed limit (small limit)', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(bytes, { maxUncompressedBytes: 2_000 }), 'too_large');
  });

  it('rejects a declared originalSize of ~2 GB without inflating it', async () => {
    const zip = zipSync({ 'case.json': strToU8('{"schemaVersion":1}') });
    const bomb = patchCentral(zip, 'case.json', (v, o) => v.setUint32(o + 24, 0x7fff_fff0, true));
    await expectImportError(importCaseZip(bomb), 'too_large', /declares 2147483632 bytes/);
  });

  it('rejects when the declared total exceeds the limit even if each entry is small', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10; i++) files[`junk/${i}.bin`] = new Uint8Array(1_000);
    await expectImportError(importCaseZip(zipSync(files), { maxUncompressedBytes: 5_000 }), 'too_large', /declares more than/);
  });

  it('stays bounded when a deflated entry under-declares its size', async () => {
    // Declared 10 bytes, real content much larger: fflate inflates into a
    // fixed buffer of the declared size, so the result is truncated JSON.
    const zip = zipSync({ 'case.json': strToU8(JSON.stringify({ schemaVersion: 1, pad: 'x'.repeat(10_000) })) });
    const liar = patchCentral(zip, 'case.json', (v, o) => v.setUint32(o + 24, 10, true));
    await expectImportError(importCaseZip(liar, { maxUncompressedBytes: 100 }), 'invalid_json');
  });

  it('rejects a missing case.json', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(rezip(bytes, (f) => delete f['case.json'])), 'missing_case_json');
    await expectImportError(importCaseZip(zipSync({})), 'missing_case_json');
  });

  it('rejects invalid JSON and invalid UTF-8', async () => {
    await expectImportError(importCaseZip(zipSync({ 'case.json': strToU8('{"schemaVersion": 1,') })), 'invalid_json');
    await expectImportError(importCaseZip(zipSync({ 'case.json': new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) })), 'invalid_json', /UTF-8/);
  });

  it('rejects an invalid manifest.json', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(rezip(bytes, (f) => (f['manifest.json'] = strToU8('nope')))), 'invalid_json', /manifest/);
    await expectImportError(importCaseZip(rezip(bytes, (f) => (f['manifest.json'] = strToU8('{"schemaVersion":1}')))), 'schema', /manifest/);
  });

  it('rejects absurdly deep nesting before parsing', async () => {
    const deep = '['.repeat(5_000) + ']'.repeat(5_000);
    await expectImportError(importCaseZip(zipSync({ 'case.json': strToU8(`{"schemaVersion":1,"x":${deep}}`) })), 'schema', /nested/);
  });

  it('rejects schemaVersion 2 as unsupported_version', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(editCaseJson(bytes, (j) => (j.schemaVersion = 2))), 'unsupported_version');
  });

  it('rejects a missing schemaVersion', async () => {
    const { bytes } = await exported();
    await expectImportError(importCaseZip(editCaseJson(bytes, (j) => delete j.schemaVersion)), 'schema');
  });

  it.each<[string, (j: { case: CaseState } & Record<string, unknown>) => void, RegExp]>([
    ['an unknown top-level key', (j) => (j.surprise = true), /Unrecognized key/],
    ['an unknown key inside case', (j) => ((j.case as unknown as Record<string, unknown>).surprise = true), /Unrecognized key/],
    ['a non-UTC timestamp', (j) => (j.case.createdAt = '2026-10-05 12:00:00'), /case\.createdAt/],
    ['an offset timestamp', (j) => (j.case.audit[0]!.at = '2026-10-05T12:00:00+01:00'), /case\.audit\[0\]\.at/],
    ['an oversized string', (j) => ((j.case.domains[0]!.lookups[0] as { raw?: string }).raw = 'x'.repeat(1_000_001)), /raw/],
  ])('rejects %s with code schema', async (_label, edit, msg) => {
    const { bytes } = await exported();
    const tampered = editCaseJson(bytes, (j) => {
      edit(j);
    });
    await expectImportError(importCaseZip(tampered), 'schema', msg);
  });

  it('rejects a __proto__ key in case.json without polluting prototypes', async () => {
    const { bytes } = await exported();
    const hostile = rezip(bytes, (f) => {
      const text = strFromU8(f['case.json']!).replace('"case": {', '"case": {"__proto__": {"polluted": true},');
      expect(text).toContain('__proto__');
      f['case.json'] = strToU8(text);
    });
    await expectImportError(importCaseZip(hostile), 'schema', /Unrecognized key/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('validates limits passed by the caller', async () => {
    const { bytes } = await exported();
    await expect(importCaseZip(bytes, { maxEntries: -1 })).rejects.toThrow(TypeError);
  });
});
