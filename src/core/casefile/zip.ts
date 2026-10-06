// Case-file ZIP export and import.
//
// Layout:
//   README.txt                         human explanation
//   case.json                          CaseFileJson, pretty-printed
//   manifest.json                      SHA-256 and size of every other file
//   evidence/<sha256>-<sanitized-name> one file per evidence item
//
// Import treats the archive as hostile: sizes and entry counts are checked
// from the ZIP headers BEFORE anything is inflated, paths are validated, only
// files we actually need are inflated, and every evidence file is re-hashed.

import { unzipSync, zipSync, type UnzipFileInfo, type Unzipped, type Zippable } from 'fflate';
import type { CaseState, EvidenceFile } from '../types';
import { canonicalJson, nowUtc, sha256Hex } from '../util';
import { verifyAuditChain, type AuditVerification } from './audit';
import { migrate } from './migrate';
import {
  CASE_SCHEMA_VERSION,
  CaseImportError,
  SCHEMA_LIMITS,
  caseFileSchema,
  formatZodIssues,
  manifestSchema,
  type CaseFileJson,
  type Manifest,
  type ManifestFile,
} from './schema';

// ───────────────────────────── Shared helpers ─────────────────────────────

export interface ImportLimits {
  /** Maximum size of the ZIP file itself. */
  maxZipBytes: number;
  /** Maximum number of entries (files and directories) in the archive. */
  maxEntries: number;
  /** Maximum total uncompressed size, declared and actual; also the per-entry maximum. */
  maxUncompressedBytes: number;
  /** Maximum size of case.json, which is decoded and parsed in memory. */
  maxCaseJsonBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxZipBytes: 200 * 1024 * 1024,
  maxEntries: 2_000,
  maxUncompressedBytes: 500 * 1024 * 1024,
  maxCaseJsonBytes: 50 * 1024 * 1024,
});

export type CaseExportErrorCode = 'invalid_state' | 'evidence_missing' | 'evidence_mismatch';

/** The in-memory case cannot be written as a valid case file. */
export class CaseExportError extends Error {
  readonly code: CaseExportErrorCode;
  constructor(code: CaseExportErrorCode, message: string) {
    super(message);
    this.name = 'CaseExportError';
    this.code = code;
  }
}

export interface ExportOptions {
  /**
   * Export even if some evidence bytes are unavailable (e.g. a case imported
   * from a ZIP that lacked them). Missing hashes are listed in the manifest
   * and README. Default false: a missing blob is an error.
   */
  allowMissingEvidence?: boolean;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  manifest: Manifest;
}

export interface ImportResult {
  state: CaseState;
  /** Evidence bytes keyed by SHA-256. */
  evidence: Map<string, Uint8Array>;
  /** Non-fatal problems the UI should show. */
  warnings: string[];
  /** Audit chain verification. A broken chain is not fatal but must be shown prominently. */
  audit: AuditVerification;
}

const SANITIZE_MAX = 100;

/**
 * Safe single path component: [A-Za-z0-9._-] only (accents are folded first;
 * other runs, and runs of two or more dots, become a single "_"), no leading
 * or trailing dots, at most 100 characters (keeping a short extension when
 * truncating). Falls back to `fallback` if nothing meaningful is left.
 */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  let s = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (s.length > SANITIZE_MAX) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(s)?.[0] ?? '';
    s = s.slice(0, SANITIZE_MAX - ext.length).replace(/\.+$/, '') + ext;
  }
  return /^[._-]*$/.test(s) ? fallback : s;
}

/** Archive path for an evidence file. */
export function evidencePath(e: Pick<EvidenceFile, 'sha256' | 'name'>): string {
  return `evidence/${e.sha256}-${sanitizeFileName(e.name)}`;
}

/** YYYYMMDDTHHMMSSZ in UTC. */
export function compactUtc(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
}

function hashBytes(b: Uint8Array): Promise<string> {
  // WebCrypto refuses views on SharedArrayBuffer; copy in that (rare) case.
  return sha256Hex(b.buffer instanceof ArrayBuffer ? (b as Uint8Array<ArrayBuffer>) : new Uint8Array(b));
}

/** True if JSON text nests objects/arrays deeper than `max`. Linear, no recursion. */
function jsonDepthExceeds(text: string, max: number): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++;
      else if (c === 34) inStr = false;
    } else if (c === 34) inStr = true;
    else if (c === 123 || c === 91) {
      if (++depth > max) return true;
    } else if (c === 125 || c === 93) depth--;
  }
  return false;
}

const enc = new TextEncoder();

// ───────────────────────────── Export ─────────────────────────────

function readmeText(exportedAt: string, missing: number): string {
  const lines = [
    'Markwatch case file',
    '===================',
    '',
    `Exported: ${exportedAt}`,
    '',
    'This ZIP archive was exported by Markwatch, a local-only domain trademark',
    'enforcement workbench. To continue working on the case, import this ZIP',
    'into Markwatch. Nothing in it was uploaded anywhere by the app.',
    '',
    'Contents',
    '  case.json      The full case: marks, inventory, settings, looked-up domains,',
    '                 lookup results, classifications, drafts and the audit log.',
    '  manifest.json  The SHA-256 hash and size in bytes of every other file.',
    '  evidence/      Evidence files, named <sha256>-<original name>.',
    '  README.txt     This file.',
    '',
    'Integrity',
    '  All hashes are SHA-256, written as lowercase hexadecimal. A file whose',
    '  recomputed SHA-256 differs from its recorded hash has been changed.',
    '  The audit log in case.json is hash-chained: each entry includes the hash',
    '  of the previous one, so a casual edit to any entry is detectable. This is',
    '  tamper-evident, not tamper-proof: someone could rewrite and re-hash the',
    '  whole log.',
    '',
    'Timestamps',
    '  All timestamps are UTC (ISO-8601, ending in "Z"), taken from the clock of',
    '  the computer that ran Markwatch. They are not certified by a third-party',
    '  timestamping service.',
    '',
  ];
  if (missing > 0) {
    lines.push(
      'Missing evidence',
      `  ${missing} evidence item(s) listed in case.json were not available when`,
      '  this file was exported; their hashes are listed in manifest.json under',
      '  "missingEvidence".',
      '',
    );
  }
  lines.push(
    'Not legal advice',
    '  Markwatch does not give legal advice. Scores are heuristics, and drafts',
    '  are starting points that require review by a qualified attorney.',
    '',
  );
  return lines.join('\n');
}

/** fflate writes DOS timestamps from local-time getters; feed it the UTC wall clock so output is timezone-independent. */
function dosMtime(now: Date): Date {
  const y = Math.min(Math.max(now.getUTCFullYear(), 1980), 2099);
  return new Date(y, now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
}

/**
 * Serializes a case into a ZIP. Deterministic: the same state, evidence, app
 * info and `now` always give identical bytes. Validates exactly the JSON text
 * that import will read, so an exported file is always importable. Does not
 * write an audit entry; the caller logs 'case.exported'.
 */
export async function exportCaseZip(
  state: CaseState,
  evidence: ReadonlyMap<string, Uint8Array>,
  app: { version: string; buildHash?: string },
  now: Date = new Date(nowUtc()),
  opts: ExportOptions = {},
): Promise<ExportResult> {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('exportCaseZip: invalid "now" date');
  const exportedAt = now.toISOString();

  const caseFile: CaseFileJson = {
    schemaVersion: CASE_SCHEMA_VERSION,
    app: app.buildHash === undefined ? { name: 'Markwatch', version: app.version } : { name: 'Markwatch', version: app.version, buildHash: app.buildHash },
    exportedAt,
    case: state,
  };
  let caseText: string;
  try {
    // The case body is written with recursively sorted keys, so two deep-equal
    // states always produce the same bytes, however their objects were built
    // (e.g. a freshly imported case re-exports byte-for-byte).
    caseText = JSON.stringify({ ...caseFile, case: JSON.parse(canonicalJson(state)) as unknown }, null, 2) + '\n';
  } catch (err) {
    throw new CaseExportError('invalid_state', `Case cannot be serialized: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (jsonDepthExceeds(caseText, SCHEMA_LIMITS.jsonDepth)) {
    throw new CaseExportError('invalid_state', `Case cannot be exported: nested deeper than ${SCHEMA_LIMITS.jsonDepth} levels`);
  }
  const check = caseFileSchema.safeParse(JSON.parse(caseText));
  if (!check.success) throw new CaseExportError('invalid_state', `Case cannot be exported: ${formatZodIssues(check.error)}`);

  // Evidence: verify every blob against its hash before it goes in the archive.
  const evidenceEntries: { path: string; data: Uint8Array; sha256: string }[] = [];
  const missing: string[] = [];
  for (const ef of state.evidence) {
    const data = evidence.get(ef.sha256);
    if (!data) {
      if (opts.allowMissingEvidence) {
        missing.push(ef.sha256);
        continue;
      }
      throw new CaseExportError('evidence_missing', `Evidence "${ef.name}" (${ef.sha256}) has no file bytes in memory; cannot export it.`);
    }
    const actual = await hashBytes(data);
    if (actual !== ef.sha256) {
      throw new CaseExportError('evidence_mismatch', `Evidence "${ef.name}" does not match its recorded SHA-256 (expected ${ef.sha256}, got ${actual}).`);
    }
    if (data.length !== ef.bytes) {
      throw new CaseExportError('evidence_mismatch', `Evidence "${ef.name}" is ${data.length} bytes but is recorded as ${ef.bytes} bytes.`);
    }
    evidenceEntries.push({ path: evidencePath(ef), data, sha256: actual });
  }

  const caseBytes = enc.encode(caseText);
  const readmeBytes = enc.encode(readmeText(exportedAt, missing.length));
  const caseJsonSha256 = await hashBytes(caseBytes);
  const files: ManifestFile[] = [
    { path: 'case.json', sha256: caseJsonSha256, bytes: caseBytes.length },
    { path: 'README.txt', sha256: await hashBytes(readmeBytes), bytes: readmeBytes.length },
    ...evidenceEntries.map((e) => ({ path: e.path, sha256: e.sha256, bytes: e.data.length })),
  ];
  const manifest: Manifest = { schemaVersion: CASE_SCHEMA_VERSION, exportedAt, files, caseJsonSha256 };
  if (missing.length > 0) manifest.missingEvidence = missing;

  const zippable: Zippable = {
    'README.txt': readmeBytes,
    'case.json': caseBytes,
    'manifest.json': enc.encode(JSON.stringify(manifest, null, 2) + '\n'),
  };
  for (const e of evidenceEntries) zippable[e.path] = e.data;
  const bytes = zipSync(zippable, { level: 6, mtime: dosMtime(now) });

  const mark = state.subject.marks[0]?.trim() ?? '';
  const fileName = `markwatch-case-${sanitizeFileName(mark, 'case')}-${compactUtc(now)}.zip`;
  return { bytes, fileName, manifest };
}

// ───────────────────────────── Import ─────────────────────────────

const EVIDENCE_RE = /^evidence\/([0-9a-f]{64})-[^/]+$/;
const KNOWN_FILES = new Set(['case.json', 'manifest.json', 'README.txt']);
const MAX_WARNINGS = 200;

function resolveLimits(partial: Partial<ImportLimits> | undefined): ImportLimits {
  const out: ImportLimits = { ...DEFAULT_IMPORT_LIMITS };
  for (const k of Object.keys(out) as (keyof ImportLimits)[]) {
    const v = partial?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new TypeError(`Invalid import limit ${k}: ${String(v)}`);
    out[k] = v;
  }
  return out;
}

function shown(name: string): string {
  return JSON.stringify(name.length > 200 ? `${name.slice(0, 200)}…` : name);
}

/** Rejects absolute paths, drive letters, backslashes, "." / ".." / empty segments and control characters. */
function checkEntryPath(name: string): void {
  const bad = (why: string) => new CaseImportError('path', `Unsafe path in archive (${why}): ${shown(name)}`);
  if (name.length === 0) throw bad('empty name');
  if (name.length > 1024) throw bad('name too long');
  if (name.includes('\\')) throw bad('backslash');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw bad('control character');
  if (name.startsWith('/')) throw bad('absolute path');
  if (/^[A-Za-z]:/.test(name)) throw bad('drive letter');
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  for (const seg of segments) {
    if (seg === '..') throw bad('".." segment');
    if (seg === '.' || seg === '') throw bad('empty or "." segment');
  }
}

function runUnzip(bytes: Uint8Array, filter: (f: UnzipFileInfo) => boolean): Unzipped {
  try {
    return unzipSync(bytes, { filter });
  } catch (err) {
    if (err instanceof CaseImportError) throw err;
    throw new CaseImportError('not_zip', `The file is not a readable ZIP archive (${err instanceof Error ? err.message : String(err)}).`);
  }
}

function decodeJson(data: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new CaseImportError('invalid_json', `${label} is not valid UTF-8 text.`);
  }
  if (jsonDepthExceeds(text, SCHEMA_LIMITS.jsonDepth)) {
    throw new CaseImportError('schema', `${label} is nested deeper than ${SCHEMA_LIMITS.jsonDepth} levels.`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CaseImportError('invalid_json', `${label} is not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
}

/**
 * Reads a case-file ZIP. Throws CaseImportError for anything that makes the
 * file unusable or untrustworthy (see codes). Returns non-fatal findings as
 * `warnings`, and the audit-chain verification separately. Does not write an
 * audit entry; the caller logs 'case.imported' (including these results).
 */
export async function importCaseZip(bytes: Uint8Array, limits?: Partial<ImportLimits>): Promise<ImportResult> {
  const lim = resolveLimits(limits);
  const warnings: string[] = [];
  let suppressed = 0;
  const warn = (w: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(w);
    else suppressed++;
  };

  if (!(bytes instanceof Uint8Array)) throw new CaseImportError('not_zip', 'Expected the ZIP file contents as bytes.');
  if (bytes.length > lim.maxZipBytes) {
    throw new CaseImportError('too_large', `The ZIP file is ${bytes.length} bytes; the limit is ${lim.maxZipBytes}.`);
  }
  // Local file header ("PK\x03\x04") or, for an empty archive, end of central directory ("PK\x05\x06").
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || !((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))) {
    throw new CaseImportError('not_zip', 'The file is not a ZIP archive.');
  }

  // Pass 1: walk every central-directory header (fflate calls the filter
  // BEFORE inflating anything), enforce limits and path rules, and inflate
  // only case.json and manifest.json.
  const entries: string[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  const checkCompression = (f: UnzipFileInfo) => {
    if (f.compression !== 0 && f.compression !== 8) {
      throw new CaseImportError('not_zip', `Unsupported compression method ${f.compression} for ${shown(f.name)}.`);
    }
  };
  const first = runUnzip(bytes, (f) => {
    if (seen.size >= lim.maxEntries) {
      throw new CaseImportError('too_many_entries', `The archive has more than ${lim.maxEntries} entries.`);
    }
    checkEntryPath(f.name);
    if (seen.has(f.name)) throw new CaseImportError('path', `Duplicate entry in archive: ${shown(f.name)}`);
    seen.add(f.name);
    entries.push(f.name);
    // Stored entries are copied at their compressed size, deflated ones are
    // inflated into a buffer of their declared size: budget the larger.
    const cost = Math.max(f.size, f.originalSize);
    if (!Number.isFinite(cost) || cost > lim.maxUncompressedBytes) {
      throw new CaseImportError('too_large', `Entry ${shown(f.name)} declares ${cost} bytes; the limit is ${lim.maxUncompressedBytes}.`);
    }
    declaredTotal += cost;
    if (declaredTotal > lim.maxUncompressedBytes) {
      throw new CaseImportError('too_large', `The archive declares more than ${lim.maxUncompressedBytes} uncompressed bytes.`);
    }
    if (f.name === 'case.json' && cost > lim.maxCaseJsonBytes) {
      throw new CaseImportError('too_large', `case.json declares ${cost} bytes; the limit is ${lim.maxCaseJsonBytes}.`);
    }
    if (f.name === 'case.json' || f.name === 'manifest.json') {
      checkCompression(f);
      return true;
    }
    return false;
  });

  let actualTotal = 0;
  const countActual = (data: Uint8Array) => {
    actualTotal += data.length;
    if (actualTotal > lim.maxUncompressedBytes) {
      throw new CaseImportError('too_large', `The archive expands to more than ${lim.maxUncompressedBytes} bytes.`);
    }
  };

  // case.json
  const caseBytes = Object.hasOwn(first, 'case.json') ? first['case.json'] : undefined;
  if (!caseBytes) throw new CaseImportError('missing_case_json', 'The archive does not contain case.json; it is not a Markwatch case file.');
  countActual(caseBytes);
  const migrated = migrate(decodeJson(caseBytes, 'case.json'));
  const parsed = caseFileSchema.safeParse(migrated);
  if (!parsed.success) throw new CaseImportError('schema', `case.json is not a valid case file: ${formatZodIssues(parsed.error)}`);
  const state: CaseState = parsed.data.case;
  const caseJsonSha256 = await hashBytes(caseBytes);

  // manifest.json (optional, but checked strictly when present)
  const manifestBytes = Object.hasOwn(first, 'manifest.json') ? first['manifest.json'] : undefined;
  let manifest: Manifest | undefined;
  if (manifestBytes) {
    countActual(manifestBytes);
    const m = manifestSchema.safeParse(decodeJson(manifestBytes, 'manifest.json'));
    if (!m.success) throw new CaseImportError('schema', `manifest.json is not valid: ${formatZodIssues(m.error)}`);
    manifest = m.data;
    if (manifest.caseJsonSha256 !== caseJsonSha256) {
      warn('case.json does not match the SHA-256 recorded in manifest.json: it was modified after export.');
    }
  } else {
    warn('The archive has no manifest.json; file hashes could not be cross-checked.');
  }
  const manifestByPath = new Map<string, ManifestFile>();
  for (const f of manifest?.files ?? []) manifestByPath.set(f.path, f);

  // Decide which evidence entries to inflate.
  const pathsByHash = new Map<string, string[]>();
  for (const name of entries) {
    if (name.endsWith('/') || KNOWN_FILES.has(name)) continue;
    const m = EVIDENCE_RE.exec(name);
    if (!m?.[1]) {
      warn(`Ignored unexpected file in archive: ${shown(name)}`);
      continue;
    }
    const list = pathsByHash.get(m[1]) ?? [];
    list.push(name);
    pathsByHash.set(m[1], list);
  }
  const wanted = new Map<string, EvidenceFile>();
  for (const ef of state.evidence) {
    const paths = pathsByHash.get(ef.sha256);
    pathsByHash.delete(ef.sha256);
    if (!paths) {
      warn(`Evidence "${ef.name}" (${ef.sha256}) is listed in case.json but its file is not in the archive.`);
      continue;
    }
    const expected = evidencePath(ef);
    const chosen = paths.includes(expected) ? expected : (paths[0] as string);
    wanted.set(chosen, ef);
    for (const p of paths) if (p !== chosen) warn(`Ignored duplicate evidence file: ${shown(p)}`);
  }
  for (const paths of pathsByHash.values()) {
    for (const p of paths) warn(`Ignored evidence file not referenced by case.json: ${shown(p)}`);
  }

  // Pass 2: inflate only the referenced evidence files and re-hash them.
  const evidence = new Map<string, Uint8Array>();
  if (wanted.size > 0) {
    const second = runUnzip(bytes, (f) => {
      if (!wanted.has(f.name)) return false;
      checkCompression(f);
      return true;
    });
    for (const [path, ef] of wanted) {
      const data = Object.hasOwn(second, path) ? second[path] : undefined;
      if (!data) {
        warn(`Evidence file ${shown(path)} could not be read from the archive.`);
        continue;
      }
      countActual(data);
      const actual = await hashBytes(data);
      if (actual !== ef.sha256) {
        throw new CaseImportError(
          'evidence_mismatch',
          `Evidence file ${shown(path)} does not match its SHA-256 (expected ${ef.sha256}, got ${actual}). It was altered or corrupted.`,
        );
      }
      const mf = manifestByPath.get(path);
      if (mf) {
        if (mf.sha256 !== actual || mf.bytes !== data.length) {
          throw new CaseImportError('evidence_mismatch', `Evidence file ${shown(path)} does not match the hash or size recorded in manifest.json.`);
        }
      } else if (manifest) {
        warn(`Evidence file ${shown(path)} is not listed in manifest.json.`);
      }
      if (data.length !== ef.bytes) warn(`Evidence "${ef.name}" is ${data.length} bytes but case.json records ${ef.bytes} bytes.`);
      evidence.set(ef.sha256, data);
    }
  }

  // Manifest entries that point at nothing.
  for (const f of manifest?.files ?? []) {
    if (!seen.has(f.path)) warn(`manifest.json lists ${shown(f.path)}, which is not in the archive.`);
  }

  // Domain evidence references must resolve.
  const known = new Set(state.evidence.map((e) => e.sha256));
  for (const d of state.domains) {
    for (const h of d.evidence) if (!known.has(h)) warn(`Domain ${shown(d.domain)} references unknown evidence ${h}.`);
  }

  const audit = await verifyAuditChain(state.audit);
  if (!audit.ok) warn(`The audit log is broken at entry ${audit.brokenAt ?? '?'}: ${audit.reason ?? 'unknown reason'}. It may have been edited.`);

  if (suppressed > 0) warnings.push(`…and ${suppressed} more warning(s).`);
  return { state, evidence, warnings, audit };
}
