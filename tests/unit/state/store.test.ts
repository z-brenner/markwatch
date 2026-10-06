import { describe, expect, it } from 'vitest';
import { CaseStore } from '../../../src/state/store';
import { verifyAuditChain } from '../../../src/core/casefile';

describe('CaseStore', () => {
  it('logs every decision in a verifiable hash chain and round-trips through a case file', async () => {
    const store = await CaseStore.create();
    store.updateSubject({ marks: ['Acme'], primaryDomain: 'acme.com', owner: 'Acme', rights: [] });
    store.replaceDomains(
      [{ domain: 'acme-x.com', unicode: 'acme-x.com', registrable: 'acme-x.com', techniques: ['dictionary'], seeds: ['acme'], sources: ['permutation'], lookups: [], acks: [], dismissedWarnings: [], drafts: [], evidence: [] }],
      { total: 1 },
    );
    store.recordLookup(['acme-x.com'], { status: 'blocked', kind: 'rdap-domain', query: 'acme-x.com', source: 'rdap.example', at: '2026-10-05T00:00:00.000Z', reason: 'cors_or_error', detail: 'x' });
    store.classify('acme-x.com', 'cybersquatting', 'test');
    store.recordAck('acme-x.com', 'counsel-consulted', 'ok');
    await store.addEvidence({ name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, ['acme-x.com']);
    await store.flush();

    const types = store.state.audit.map((a) => a.type);
    expect(types).toEqual(['case.created', 'settings.changed', 'discovery.run', 'lookup', 'classification.set', 'ack.recorded', 'evidence.added']);
    expect((await verifyAuditChain(store.state.audit)).ok).toBe(true);
    expect(store.getSnapshot().dirty).toBe(true);
    expect(store.state.domains[0]!.score?.items.map((i) => i.ruleId)).toEqual([]);

    const { bytes } = await store.exportCase();
    expect(store.getSnapshot().dirty).toBe(false);

    const fresh = await CaseStore.create();
    await fresh.importCase(bytes);
    await fresh.flush();
    expect(fresh.state.domains[0]!.classification?.value).toBe('cybersquatting');
    expect(fresh.evidenceBytes(fresh.state.evidence[0]!.sha256)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fresh.getSnapshot().importAudit?.ok).toBe(true);
    expect(fresh.state.audit.at(-1)!.type).toBe('case.imported');
    expect((await verifyAuditChain(fresh.state.audit)).ok).toBe(true);
  });

  it('imports counsel templates that override built-ins, and keeps them in the case', async () => {
    const store = await CaseStore.create();
    const src = `---\nid: demand-letter\ntitle: Counsel letter\nchannel: letter\nclasses: cybersquatting\n---\nDRAFT. Attorney review required before sending.\nHello {{domain}}\n`;
    const r = await store.importTemplate(src, 'counsel.md');
    expect(r.ok).toBe(true);
    expect(store.getSnapshot().templates.find((t) => t.id === 'demand-letter')?.title).toBe('Counsel letter');
    expect(store.state.templates).toHaveLength(1);
    const bad = await store.importTemplate('no front matter', 'bad.md');
    expect(bad.ok).toBe(false);
  });
});
