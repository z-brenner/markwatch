import { afterEach, describe, expect, it } from 'vitest';
import { GENESIS_HASH, appendAudit, auditHashInput, verifyAuditChain } from '../../../src/core/casefile/audit';
import type { AuditEntry } from '../../../src/core/types';
import { setClockForTests } from '../../../src/core/util';

async function chain(n: number): Promise<AuditEntry[]> {
  let log: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    log = await appendAudit(log, { actor: i % 2 ? 'user' : 'system', type: 'lookup', payload: { i, domain: `d${i}.com` }, at: `2026-10-05T12:0${i}:00.000Z` });
  }
  return log;
}

describe('appendAudit', () => {
  afterEach(() => setClockForTests(() => new Date()));

  it('matches a hard-coded known vector (catches accidental algorithm changes)', async () => {
    const log = await appendAudit([], { actor: 'user', type: 'case.created', payload: { mark: 'Acme', caseId: 'case-1' }, at: '2026-10-05T12:00:00.000Z' });
    expect(log).toHaveLength(1);
    const e = log[0]!;
    expect(auditHashInput(e.prevHash, e)).toBe(
      GENESIS_HASH + '{"actor":"user","at":"2026-10-05T12:00:00.000Z","payload":{"caseId":"case-1","mark":"Acme"},"seq":1,"type":"case.created"}',
    );
    // Computed independently with Node's crypto.createHash('sha256').
    expect(e.hash).toBe('f15d342ddb993ca83c9d3657e3a540d3c617c1001bbb0af245c488cd5ba08599');
    expect(e).toEqual({
      seq: 1,
      at: '2026-10-05T12:00:00.000Z',
      actor: 'user',
      type: 'case.created',
      payload: { caseId: 'case-1', mark: 'Acme' },
      prevHash: GENESIS_HASH,
      hash: 'f15d342ddb993ca83c9d3657e3a540d3c617c1001bbb0af245c488cd5ba08599',
    });
  });

  it('never mutates the input log and links seq/prevHash', async () => {
    const one = await chain(1);
    const snapshot = structuredClone(one);
    const two = await appendAudit(one, { actor: 'user', type: 'ack.recorded', payload: { id: 'a' }, at: '2026-10-05T13:00:00.000Z' });
    expect(one).toEqual(snapshot);
    expect(one).toHaveLength(1);
    expect(two).not.toBe(one);
    expect(two[0]).toBe(one[0]);
    expect(two[1]!.seq).toBe(2);
    expect(two[1]!.prevHash).toBe(one[0]!.hash);
    expect(one[0]!.prevHash).toBe(GENESIS_HASH);
  });

  it('stores a deep copy of the payload, so later caller mutation cannot break the hash', async () => {
    const payload = { list: [1, 2], inner: { x: 'y' } };
    const log = await appendAudit([], { actor: 'user', type: 'lookup', payload, at: '2026-10-05T12:00:00.000Z' });
    payload.list.push(3);
    payload.inner.x = 'changed';
    expect(log[0]!.payload).toEqual({ list: [1, 2], inner: { x: 'y' } });
    expect((await verifyAuditChain(log)).ok).toBe(true);
  });

  it('uses the injectable clock when no timestamp is given', async () => {
    setClockForTests(() => new Date('2030-01-02T03:04:05.006Z'));
    const log = await appendAudit([], { actor: 'system', type: 'case.created', payload: {} });
    expect(log[0]!.at).toBe('2030-01-02T03:04:05.006Z');
  });

  it('drops undefined top-level payload values, like canonicalJson', async () => {
    const log = await appendAudit([], { actor: 'user', type: 'lookup', payload: { a: 1, b: undefined }, at: '2026-10-05T12:00:00.000Z' });
    expect(Object.keys(log[0]!.payload)).toEqual(['a']);
  });

  it.each([
    ['a function', { f: () => 1 }],
    ['a nested function', { a: [{ f: () => 1 }] }],
    ['a symbol', { s: Symbol('x') }],
    ['a bigint', { n: 1n }],
    ['NaN', { n: Number.NaN }],
    ['Infinity', { n: Number.POSITIVE_INFINITY }],
    ['a Date', { d: new Date() }],
    ['a Map', { m: new Map() }],
    ['an undefined array element', { a: [1, undefined] }],
  ])('rejects a payload containing %s', async (_label, payload) => {
    await expect(appendAudit([], { actor: 'user', type: 'lookup', payload, at: '2026-10-05T12:00:00.000Z' })).rejects.toThrow(TypeError);
  });

  it('rejects circular payloads and __proto__ keys', async () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    await expect(appendAudit([], { actor: 'user', type: 'lookup', payload: circ })).rejects.toThrow(/circular/);
    const proto = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>;
    await expect(appendAudit([], { actor: 'user', type: 'lookup', payload: proto })).rejects.toThrow(/__proto__/);
  });

  it('rejects bad timestamps, actors and types', async () => {
    await expect(appendAudit([], { actor: 'user', type: 'lookup', payload: {}, at: '2026-10-05T12:00:00+02:00' })).rejects.toThrow(/UTC/);
    await expect(appendAudit([], { actor: 'admin' as 'user', type: 'lookup', payload: {} })).rejects.toThrow(/actor/);
    await expect(appendAudit([], { actor: 'user', type: 'nope' as 'lookup', payload: {} })).rejects.toThrow(/type/);
  });
});

describe('verifyAuditChain', () => {
  it('accepts an empty log and a valid chain', async () => {
    expect(await verifyAuditChain([])).toEqual({ ok: true, warnings: [] });
    expect(await verifyAuditChain(await chain(5))).toEqual({ ok: true, warnings: [] });
  });

  it('detects an edited payload at the right position', async () => {
    const log = structuredClone(await chain(5));
    log[2]!.payload.domain = 'evil.com';
    const r = await verifyAuditChain(log);
    expect(r).toMatchObject({ ok: false, brokenAt: 3 });
    expect(r.reason).toMatch(/altered/);
  });

  it('detects an edited timestamp, actor or type', async () => {
    // Entry 4 (index 3) was written as actor 'user', type 'lookup', at 12:03.
    const edits: ((e: AuditEntry) => void)[] = [(e) => (e.at = '2026-10-05T12:03:30.000Z'), (e) => (e.actor = 'system'), (e) => (e.type = 'evidence.removed')];
    for (const edit of edits) {
      const log = structuredClone(await chain(5));
      edit(log[3]!);
      expect(await verifyAuditChain(log)).toMatchObject({ ok: false, brokenAt: 4 });
    }
  });

  it('detects a deleted entry', async () => {
    const log = await chain(5);
    const r = await verifyAuditChain([...log.slice(0, 2), ...log.slice(3)]);
    expect(r).toMatchObject({ ok: false, brokenAt: 3 });
    expect(r.reason).toMatch(/seq/);
  });

  it('detects reordered entries', async () => {
    const log = await chain(5);
    const r = await verifyAuditChain([log[0]!, log[2]!, log[1]!, log[3]!, log[4]!]);
    expect(r).toMatchObject({ ok: false, brokenAt: 2 });
  });

  it('detects renumbered entries after a deletion (prevHash linkage)', async () => {
    const log = structuredClone(await chain(5));
    const cut = [...log.slice(0, 2), ...log.slice(3)];
    cut.forEach((e, i) => (e.seq = i + 1));
    expect(await verifyAuditChain(cut)).toMatchObject({ ok: false, brokenAt: 3, reason: expect.stringMatching(/prevHash/) as unknown });
  });

  it('detects a first entry that does not start from genesis', async () => {
    const log = structuredClone(await chain(2));
    log[0]!.prevHash = 'f'.repeat(64);
    expect(await verifyAuditChain(log)).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it('cannot detect truncation of the tail (documented limitation)', async () => {
    const log = await chain(5);
    expect((await verifyAuditChain(log.slice(0, 3))).ok).toBe(true);
  });

  it('reports out-of-order timestamps as warnings, not breaks', async () => {
    let log: AuditEntry[] = [];
    log = await appendAudit(log, { actor: 'user', type: 'lookup', payload: {}, at: '2026-10-05T12:00:00.000Z' });
    log = await appendAudit(log, { actor: 'user', type: 'lookup', payload: {}, at: '2026-10-05T11:00:00.000Z' });
    log = await appendAudit(log, { actor: 'user', type: 'lookup', payload: {}, at: '2026-10-05T11:00:00.000Z' });
    const r = await verifyAuditChain(log);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Entry 2/);
  });

  it('never throws on garbage input', async () => {
    const r = await verifyAuditChain([null as unknown as AuditEntry]);
    expect(r).toMatchObject({ ok: false, brokenAt: 1 });
  });
});
