// The in-memory case store. It is the only owner of case state, evidence
// bytes and the audit log. Nothing here touches browser storage: closing the
// tab discards everything not exported as a case file.
//
// Every user decision and every lookup is appended to a hash-chained audit
// log. Appends are serialized through a promise queue because each entry's
// hash depends on the previous one.
import { appendAudit, exportCaseZip, importCaseZip, newCaseState } from '../core/casefile';
import { rulesetFingerprint, scoreDomain } from '../core/score/engine';
import { RULES, RULESET_VERSION } from '../config/scoring.rules';
import { buildFacts } from '../pipeline/facts';
import { nowUtc, sha256Hex } from '../core/util';
import { DEFAULT_DICTIONARY, RISKY_KEYWORDS } from '../config/keywords';
import { DEFAULT_TLDS } from '../config/tlds';
import { DEFAULT_TECHNIQUES } from '../core/permute';
import { builtinTemplates, resolveTemplates, validateImportedTemplate, type ParsedTemplate } from '../core/draft';
import type {
  AuditEntry,
  AuditType,
  CaseSettings,
  CaseState,
  CaseSubject,
  Classification,
  DomainRecord,
  DraftRecord,
  EvidenceFile,
  InventoryEntry,
  LookupResult,
  SenderDetails,
} from '../core/types';

export const APP_VERSION = '0.1.0';

export const DEFAULT_SETTINGS: CaseSettings = {
  cap: 5000,
  techniques: [...DEFAULT_TECHNIQUES],
  keyboards: ['qwerty'],
  tlds: [...DEFAULT_TLDS],
  dictionary: [...DEFAULT_DICTIONARY],
  riskyKeywords: [...RISKY_KEYWORDS],
  primaryResolver: 'cloudflare',
  useAbusix: true,
  ctEnabled: true,
};

type Listener = () => void;

export interface StoreSnapshot {
  state: CaseState;
  /** Unexported changes exist. */
  dirty: boolean;
  /** Imported template sources parsed and ready (builtins + imports, imports override). */
  templates: ParsedTemplate[];
  /** Result of verifying the audit chain on the last import, if any. */
  importAudit?: { ok: boolean; brokenAt?: number; reason?: string; warnings: string[] };
  importWarnings: string[];
}

function randomId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class CaseStore {
  private snap: StoreSnapshot;
  private listeners = new Set<Listener>();
  private auditQueue: Promise<void> = Promise.resolve();
  private evidence = new Map<string, Uint8Array<ArrayBuffer>>();
  private importedSources = new Map<string, { source: string; template: ParsedTemplate }>();
  private builtins = builtinTemplates();
  /** Primary-domain NS, used by the "same nameservers" scoring rule. */
  primaryNs: string[] = [];

  private constructor(state: CaseState) {
    this.snap = { state, dirty: false, templates: this.builtins, importWarnings: [] };
  }

  static async create(): Promise<CaseStore> {
    const ruleset = await rulesetFingerprint();
    const now = nowUtc();
    const store = new CaseStore(newCaseState({ id: randomId(), now, ruleset, settings: DEFAULT_SETTINGS }));
    await store.audit('system', 'case.created', { rulesetVersion: RULESET_VERSION, rulesetSha256: ruleset.sha256 });
    store.snap = { ...store.snap, dirty: false };
    return store;
  }

  // ── subscription (useSyncExternalStore) ──
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): StoreSnapshot => this.snap;
  get state(): CaseState {
    return this.snap.state;
  }

  private notifyTimer: ReturnType<typeof setTimeout> | undefined;

  private set(state: CaseState, extra: Partial<StoreSnapshot> = {}, dirty = true): void {
    this.snap = { ...this.snap, ...extra, state, dirty: dirty || this.snap.dirty };
    this.scheduleNotify();
  }

  /** Coalesces bursts (thousands of lookups and audit appends) into ~10 renders per second. */
  private scheduleNotify(): void {
    if (this.notifyTimer !== undefined) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      for (const l of this.listeners) l();
    }, 100);
  }

  /** Appends an audit entry. Serialized; resolves once the entry is in state. */
  audit(actor: 'user' | 'system', type: AuditType, payload: Record<string, unknown>): Promise<void> {
    const job = this.auditQueue.then(async () => {
      const log: AuditEntry[] = await appendAudit(this.snap.state.audit, { actor, type, payload });
      this.set({ ...this.snap.state, audit: log });
    });
    this.auditQueue = job.catch(() => undefined);
    return job;
  }

  /** Waits for pending audit appends (used before export and in tests). */
  flush(): Promise<void> {
    return this.auditQueue;
  }

  // ── subject, sender, inventory, settings ──
  updateSubject(subject: CaseSubject): void {
    this.set({ ...this.state, subject });
    void this.audit('user', 'settings.changed', { field: 'subject', marks: subject.marks, primaryDomain: subject.primaryDomain, owner: subject.owner, rights: subject.rights.length });
  }

  updateSender(sender: SenderDetails): void {
    this.set({ ...this.state, sender });
  }

  setInventory(inventory: InventoryEntry[]): void {
    this.set({ ...this.state, inventory });
    void this.audit('user', 'inventory.changed', {
      owned: inventory.filter((i) => i.kind === 'owned').length,
      authorized: inventory.filter((i) => i.kind === 'authorized').length,
    });
  }

  updateSettings(settings: CaseSettings): void {
    this.set({ ...this.state, settings });
    void this.audit('user', 'settings.changed', { field: 'settings', cap: settings.cap, techniques: settings.techniques, resolver: settings.primaryResolver, useAbusix: settings.useAbusix, ctEnabled: settings.ctEnabled });
  }

  // ── discovery and lookups ──
  replaceDomains(domains: DomainRecord[], summary: Record<string, unknown>): void {
    this.set({ ...this.state, domains: domains.map((d) => this.rescore(d)) });
    void this.audit('system', 'discovery.run', summary);
  }

  /** Applies a lookup result to the given domains and logs it once. */
  recordLookup(domains: string[], result: LookupResult<unknown>, actor: 'user' | 'system' = 'system'): void {
    const set = new Set(domains);
    this.set({
      ...this.state,
      domains: this.state.domains.map((d) => (set.has(d.domain) ? this.rescore({ ...d, lookups: [...d.lookups, result] }) : d)),
    });
    void this.audit(actor, result.status === 'manual' ? 'lookup.manual' : 'lookup', {
      kind: result.kind,
      query: result.query,
      status: result.status,
      source: result.source,
      ...(result.url ? { url: result.url } : {}),
      ...(result.status === 'blocked' ? { reason: result.reason } : {}),
      domains: domains.length > 5 ? [...domains.slice(0, 5), `…+${domains.length - 5}`] : domains,
    });
  }

  private rescore(d: DomainRecord): DomainRecord {
    const facts = d.lookups.length ? buildFacts(d) : undefined;
    const score = scoreDomain({
      domain: d.domain,
      techniques: d.techniques,
      ...(facts ? { facts } : {}),
      primaryNs: this.primaryNs,
      ownerName: this.state.subject.owner,
      riskyKeywords: this.state.settings.riskyKeywords,
      now: new Date(),
    });
    const { facts: _f, ...rest } = d;
    return { ...rest, ...(facts ? { facts } : {}), score };
  }

  rescoreAll(): void {
    this.set({ ...this.state, domains: this.state.domains.map((d) => this.rescore(d)) }, {}, false);
  }

  private patchDomain(domain: string, fn: (d: DomainRecord) => DomainRecord): void {
    this.set({ ...this.state, domains: this.state.domains.map((d) => (d.domain === domain ? fn(d) : d)) });
  }

  // ── classification and acknowledgments ──
  classify(domain: string, value: Classification, note?: string): void {
    const at = nowUtc();
    this.patchDomain(domain, (d) => ({ ...d, classification: { value, at, ...(note ? { note } : {}) } }));
    void this.audit('user', 'classification.set', { domain, value, ...(note ? { note } : {}) });
  }

  clearClassification(domain: string): void {
    this.patchDomain(domain, (d) => {
      const { classification: _c, ...rest } = d;
      return rest;
    });
    void this.audit('user', 'classification.cleared', { domain });
  }

  recordAck(domain: string, id: string, text: string): void {
    const at = nowUtc();
    this.patchDomain(domain, (d) => ({ ...d, acks: [...d.acks.filter((a) => a.id !== id), { id, at, text }] }));
    void this.audit('user', 'ack.recorded', { domain, id, text });
  }

  dismissWarning(domain: string, id: string): void {
    this.patchDomain(domain, (d) => ({ ...d, dismissedWarnings: [...new Set([...d.dismissedWarnings, id])] }));
    void this.audit('user', 'warning.dismissed', { domain, id });
  }

  // ── evidence ──
  async addEvidence(file: { name: string; type: string; bytes: Uint8Array<ArrayBuffer> }, domains: string[], note?: string): Promise<EvidenceFile> {
    const sha256 = await sha256Hex(file.bytes);
    this.evidence.set(sha256, file.bytes);
    const ev: EvidenceFile = { sha256, name: file.name, type: file.type || 'application/octet-stream', bytes: file.bytes.byteLength, addedAt: nowUtc(), domains, ...(note ? { note } : {}) };
    const others = this.state.evidence.filter((e) => e.sha256 !== sha256);
    this.set({
      ...this.state,
      evidence: [...others, ev],
      domains: this.state.domains.map((d) => (domains.includes(d.domain) ? { ...d, evidence: [...new Set([...d.evidence, sha256])] } : d)),
    });
    await this.audit('user', 'evidence.added', { sha256, name: ev.name, bytes: ev.bytes, domains });
    return ev;
  }

  removeEvidence(sha256: string): void {
    this.evidence.delete(sha256);
    this.set({
      ...this.state,
      evidence: this.state.evidence.filter((e) => e.sha256 !== sha256),
      domains: this.state.domains.map((d) => ({ ...d, evidence: d.evidence.filter((s) => s !== sha256) })),
    });
    void this.audit('user', 'evidence.removed', { sha256 });
  }

  evidenceBytes(sha256: string): Uint8Array<ArrayBuffer> | undefined {
    return this.evidence.get(sha256);
  }

  // ── templates ──
  async importTemplate(source: string, name: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
    const v = validateImportedTemplate(source, name);
    if (!v.ok) return { ok: false, errors: v.errors, warnings: [] };
    const sha256 = await sha256Hex(source);
    this.importedSources.set(v.template.id, { source, template: v.template });
    const templates = this.state.templates.filter((t) => t.id !== v.template.id);
    const entry = { id: v.template.id, source, importedAt: nowUtc(), sha256 };
    this.set({ ...this.state, templates: [...templates, entry] }, { templates: this.resolvedTemplates() });
    await this.audit('user', 'template.imported', { id: v.template.id, name, sha256, overridesBuiltin: this.builtins.some((b) => b.id === v.template.id) });
    return { ok: true, errors: [], warnings: v.warnings };
  }

  removeTemplate(id: string): void {
    this.importedSources.delete(id);
    this.set({ ...this.state, templates: this.state.templates.filter((t) => t.id !== id) }, { templates: this.resolvedTemplates() });
  }

  private resolvedTemplates(): ParsedTemplate[] {
    return resolveTemplates(this.builtins, [...this.importedSources.values()].map((x) => x.template));
  }

  // ── drafts ──
  createDraft(domain: string, templateId: string): DraftRecord {
    const draft: DraftRecord = { id: randomId(), templateId, createdAt: nowUtc(), body: '', values: {}, dismissed: [], exports: [] };
    this.patchDomain(domain, (d) => ({ ...d, drafts: [...d.drafts, draft] }));
    void this.audit('user', 'draft.created', { domain, templateId, draftId: draft.id });
    return draft;
  }

  updateDraft(domain: string, draftId: string, fn: (d: DraftRecord) => DraftRecord): void {
    this.patchDomain(domain, (d) => ({ ...d, drafts: d.drafts.map((x) => (x.id === draftId ? fn(x) : x)) }));
  }

  dismissDraftField(domain: string, draftId: string, field: string, reason: string): void {
    this.updateDraft(domain, draftId, (d) => ({ ...d, dismissed: [...d.dismissed.filter((x) => x.field !== field), { field, reason }] }));
    void this.audit('user', 'draft.field_dismissed', { domain, draftId, field, reason });
  }

  async recordDraftExport(domain: string, draftId: string, format: 'eml' | 'mailto' | 'copy' | 'txt', text: string, templateId: string, dismissed: string[]): Promise<void> {
    const sha256 = await sha256Hex(text);
    const at = nowUtc();
    this.updateDraft(domain, draftId, (d) => ({ ...d, exports: [...d.exports, { at, format, sha256 }] }));
    await this.audit('user', 'draft.exported', { domain, draftId, templateId, format, sha256, dismissedFields: dismissed });
  }

  // ── case file ──
  async exportCase(): Promise<{ bytes: Uint8Array; fileName: string }> {
    await this.audit('user', 'case.exported', { domains: this.state.domains.length, evidence: this.state.evidence.length });
    await this.flush();
    const out = await exportCaseZip(this.state, this.evidence, { version: APP_VERSION });
    this.snap = { ...this.snap, dirty: false };
    this.scheduleNotify();
    return { bytes: out.bytes, fileName: out.fileName };
  }

  async importCase(bytes: Uint8Array): Promise<void> {
    // An in-flight audit append would otherwise write the old chain over the imported one.
    await this.flush();
    const res = await importCaseZip(bytes);
    this.evidence = new Map([...res.evidence].map(([k, v]) => [k, new Uint8Array(v)]));
    this.importedSources.clear();
    const warnings = [...res.warnings];
    for (const t of res.state.templates) {
      const v = validateImportedTemplate(t.source, t.id);
      if (v.ok) this.importedSources.set(v.template.id, { source: t.source, template: v.template });
      else warnings.push(`Imported template ${t.id} is invalid and was not loaded: ${v.errors.join('; ')}`);
    }
    this.set(res.state, { templates: this.resolvedTemplates(), importAudit: res.audit, importWarnings: warnings }, false);
    await this.audit('user', 'case.imported', { auditChainOk: res.audit.ok, ...(res.audit.ok ? {} : { brokenAt: res.audit.brokenAt }), warnings: warnings.length });
    this.snap = { ...this.snap, dirty: false };
    this.scheduleNotify();
  }
}
