import type { IsoUtc } from './types';

/** Current time as ISO-8601 UTC with "Z". Injectable clock for tests. */
let clock: () => Date = () => new Date();
export function nowUtc(): IsoUtc {
  return clock().toISOString();
}
export function setClockForTests(fn: () => Date): void {
  clock = fn;
}

const enc = new TextEncoder();

/** SHA-256 as lowercase hex, via WebCrypto (browser and Node 20+). */
export async function sha256Hex(data: string | Uint8Array<ArrayBuffer> | ArrayBuffer): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic JSON: object keys sorted recursively. Used for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}
