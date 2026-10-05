// Append-only, hash-chained audit log.
//
// What this does and does not prove (be honest in the UI too):
//  - Each entry's hash covers the previous entry's hash and its own content
//    (seq, at, actor, type, payload), so editing, deleting, inserting or
//    reordering an entry in an exported case.json breaks the chain from that
//    point on. That makes the log TAMPER-EVIDENT against casual edits.
//  - It is NOT tamper-proof. There is no secret and no third party involved:
//    anyone can rewrite the whole chain and recompute every hash. Removing
//    entries from the END of the log is also undetectable from the chain alone
//    (the manifest's case.json hash flags it, but can be rewritten too).
//  - Timestamps come from the local machine clock. They are not attested by a
//    trusted timestamping service (RFC 3161 would need a network request to a
//    third party). Out-of-order timestamps are reported as warnings only.

import type { AuditEntry, AuditType, IsoUtc } from '../types';
import { canonicalJson, nowUtc, sha256Hex } from '../util';
import { AUDIT_TYPES } from './schema';

export const GENESIS_HASH = '0'.repeat(64);

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const AUDIT_TYPE_SET: ReadonlySet<string> = new Set(AUDIT_TYPES);

export interface AuditVerification {
  ok: boolean;
  /** 1-based position of the first broken entry (equal to the seq it should have). */
  brokenAt?: number;
  reason?: string;
  /** Non-fatal observations, e.g. timestamps that go backwards. */
  warnings: string[];
}

export interface AuditInput {
  actor: 'user' | 'system';
  type: AuditType;
  payload: Record<string, unknown>;
  at?: IsoUtc;
}

/** The exact bytes hashed for an entry: prevHash followed by canonical JSON of the content. */
export function auditHashInput(prevHash: string, e: Pick<AuditEntry, 'seq' | 'at' | 'actor' | 'type' | 'payload'>): string {
  return prevHash + canonicalJson({ seq: e.seq, at: e.at, actor: e.actor, type: e.type, payload: e.payload });
}

export async function computeAuditHash(prevHash: string, e: Pick<AuditEntry, 'seq' | 'at' | 'actor' | 'type' | 'payload'>): Promise<string> {
  return sha256Hex(auditHashInput(prevHash, e));
}

/**
 * Returns a NEW log with one entry appended; the input array is never touched.
 * The payload is validated as plain JSON and stored as a deep, key-sorted copy,
 * so later mutation of the caller's object cannot invalidate the hash, and the
 * stored payload round-trips through JSON unchanged.
 */
export async function appendAudit(log: readonly AuditEntry[], e: AuditInput): Promise<AuditEntry[]> {
  if (e.actor !== 'user' && e.actor !== 'system') throw new TypeError(`Invalid audit actor: ${String(e.actor)}`);
  if (!AUDIT_TYPE_SET.has(e.type)) throw new TypeError(`Invalid audit type: ${String(e.type)}`);
  if (!isPlainObject(e.payload)) throw new TypeError('Audit payload must be a plain object');
  assertJsonValue(e.payload, 'payload', new Set());

  const at = e.at ?? nowUtc();
  if (typeof at !== 'string' || !ISO_UTC_RE.test(at) || Number.isNaN(Date.parse(at))) {
    throw new TypeError(`Audit timestamp must be ISO-8601 UTC ending in "Z": ${String(at)}`);
  }

  const prev = log.length > 0 ? log[log.length - 1] : undefined;
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const payload = JSON.parse(canonicalJson(e.payload)) as Record<string, unknown>;
  const hash = await computeAuditHash(prevHash, { seq, at, actor: e.actor, type: e.type, payload });
  return [...log, { seq, at, actor: e.actor, type: e.type, payload, prevHash, hash }];
}

/**
 * Verifies seq continuity (1, 2, 3…), prevHash linkage, every recomputed hash,
 * and timestamp order. The first structural break stops verification; the
 * timestamp check only produces warnings. Never throws.
 */
export async function verifyAuditChain(log: readonly AuditEntry[]): Promise<AuditVerification> {
  const warnings: string[] = [];
  let prevHash = GENESIS_HASH;
  let prevTime = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < log.length; i++) {
    const pos = i + 1;
    const e = log[i];
    const broken = (reason: string): AuditVerification => ({ ok: false, brokenAt: pos, reason, warnings });
    try {
      if (!e || typeof e !== 'object') return broken('Entry is not an object');
      if (e.seq !== pos) return broken(`Expected seq ${pos} but found ${String(e.seq)} (entry missing, inserted or reordered)`);
      if (typeof e.hash !== 'string' || !SHA256_RE.test(e.hash)) return broken('Entry hash is not a SHA-256 hex string');
      if (e.prevHash !== prevHash) {
        return broken(i === 0 ? 'First entry does not start from the genesis hash' : `prevHash does not match the hash of entry ${pos - 1}`);
      }
      const recomputed = await computeAuditHash(prevHash, e);
      if (recomputed !== e.hash) return broken('Hash does not match the entry content (entry was altered)');

      const t = typeof e.at === 'string' ? Date.parse(e.at) : Number.NaN;
      if (Number.isNaN(t)) warnings.push(`Entry ${pos} has an unreadable timestamp`);
      else {
        if (t < prevTime) warnings.push(`Entry ${pos} is timestamped earlier than entry ${pos - 1} (local clock change?)`);
        prevTime = t;
      }
      prevHash = e.hash;
    } catch (err) {
      return broken(`Entry could not be verified: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: true, warnings };
}

// ───────────────────────────── JSON validation ─────────────────────────────

const MAX_PAYLOAD_DEPTH = 32;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Throws unless `v` survives a JSON round trip unchanged: null, booleans,
 * finite numbers, strings, arrays and plain objects only. Undefined object
 * values are allowed (they are dropped, as JSON would), but not undefined
 * array elements (JSON would turn them into null).
 */
function assertJsonValue(v: unknown, path: string, stack: Set<object>, depth = 0): void {
  if (depth > MAX_PAYLOAD_DEPTH) throw new TypeError(`Audit payload nested too deeply at ${path}`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`Audit payload has a non-finite number at ${path}`);
    return;
  }
  if (typeof v !== 'object') throw new TypeError(`Audit payload has a non-JSON value (${typeof v}) at ${path}`);
  if (stack.has(v)) throw new TypeError(`Audit payload has a circular reference at ${path}`);
  stack.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const item: unknown = v[i];
      if (item === undefined) throw new TypeError(`Audit payload has an undefined array element at ${path}[${i}]`);
      assertJsonValue(item, `${path}[${i}]`, stack, depth + 1);
    }
  } else {
    if (!isPlainObject(v)) throw new TypeError(`Audit payload has a non-plain object at ${path}`);
    for (const k of Object.keys(v)) {
      if (k === '__proto__') throw new TypeError(`Audit payload has a forbidden "__proto__" key at ${path}`);
      const val = v[k];
      if (val !== undefined) assertJsonValue(val, `${path}.${k}`, stack, depth + 1);
    }
  }
  stack.delete(v);
}
