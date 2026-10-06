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

describe('CaseStore review regressions', () => {
  const rec = (domain: string) => ({ domain, unicode: domain, registrable: domain, techniques: [], seeds: [], sources: ['manual' as const], lookups: [], acks: [], dismissedWarnings: [], drafts: [], evidence: [] });

  it('relabels existing domains when the inventory changes (no stale "unlabelled" authorized domains)', async () => {
    const store = await CaseStore.create();
    store.updateSubject({ marks: ['Acme'], primaryDomain: 'acme.com', owner: 'Acme', rights: [] });
    store.replaceDomains([rec('partner-acme.com'), rec('evil-acme.com')], {});
    expect(store.state.domains[0]!.inventory).toBeUndefined();
    store.setInventory([{ pattern: 'partner-acme.com', kind: 'authorized', party: 'Partner' }]);
    expect(store.state.domains[0]!.inventory).toMatchObject({ kind: 'authorized', party: 'Partner' });
    expect(store.state.domains[1]!.inventory).toBeUndefined();
    store.setInventory([]);
    expect(store.state.domains[0]!.inventory).toBeUndefined();
  });

  it('import: drops queued audit writes for the old case, recomputes facts, and drops acks missing from the audit log', async () => {
    const a = await CaseStore.create();
    a.updateSubject({ marks: ['Acme'], primaryDomain: 'acme.com', owner: 'Acme', rights: [] });
    a.replaceDomains([rec('acme-x.com')], {});
    a.recordAck('acme-x.com', 'counsel-consulted', 'ok — confirmed by Pat');
    await a.flush();
    const { bytes } = await a.exportCase();

    // Hand-edit the case: add an acknowledgment that never went through the app.
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['case.json']!)) as { case: { domains: { acks: { id: string; at: string; text: string }[]; facts?: unknown }[] } };
    json.case.domains[0]!.acks.push({ id: 'dmca-fair-use-considered', at: '2026-10-05T00:00:00.000Z', text: 'forged' });
    files['case.json'] = strToU8(JSON.stringify(json));
    delete files['manifest.json'];

    const b = await CaseStore.create();
    b.primaryNs = ['ns1.stale.example'];
    void b.audit('system', 'settings.changed', { stale: true }); // queued for the old case
    await b.importCase(zipSync(files));
    await b.flush();
    expect(b.primaryNs).toEqual([]);
    expect(b.state.audit.some((e) => e.payload.stale === true)).toBe(false);
    const acks = b.state.domains[0]!.acks.map((x) => x.id);
    expect(acks).toEqual(['counsel-consulted']);
    expect(b.getSnapshot().importWarnings.join(' ')).toMatch(/not in the audit log/);
    expect(b.state.domains[0]!.score).toBeDefined();
  });

  it('a pasted WHOIS-derived RDAP record stays exportable', async () => {
    const store = await CaseStore.create();
    store.replaceDomains([rec('acme-x.com')], {});
    store.recordLookup(
      ['acme-x.com'],
      { status: 'manual', kind: 'rdap-domain', query: 'acme-x.com', source: 'x (pasted by user)', at: '2026-10-05T00:00:00.000Z', pastedText: 'Registrar: X', data: { ldhName: 'acme-x.com', status: [], nameservers: [], redactedFields: [], server: 'manual (WHOIS text pasted by user)', registrar: { name: 'X', abuseEmail: ['abuse@x.example'], abuseTel: [] } } },
      'user',
    );
    await expect(store.exportCase()).resolves.toBeDefined();
  });

  it('audit writes racing an import never replace the imported log', async () => {
    const a = await CaseStore.create();
    a.updateSubject({ marks: ['Alpha'], primaryDomain: 'alpha.com', owner: 'A', rights: [] });
    await a.importTemplate(`---\nid: demand-letter\ntitle: Counsel letter\nchannel: letter\nclasses: cybersquatting\n---\nDRAFT. Attorney review required before sending.\nHi {{domain}}\n`, 'c.md');
    await a.flush();
    const { bytes } = await a.exportCase();
    const importedHashes = a.state.audit.map((e) => e.hash);

    const b = await CaseStore.create();
    let racing = true;
    const spam = async () => {
      while (racing) {
        void b.audit('system', 'settings.changed', { race: true });
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    const spammer = spam();
    await b.importCase(bytes);
    racing = false;
    await spammer;
    await b.flush();
    // The imported history is intact as a prefix of the log.
    expect(b.state.audit.slice(0, importedHashes.length).map((e) => e.hash)).toEqual(importedHashes);
    expect(b.state.subject.primaryDomain).toBe('alpha.com');
    expect((await verifyAuditChain(b.state.audit)).ok).toBe(true);
  });
});
