import type { CaseSettings, CaseState, IsoUtc } from '../types';

/**
 * An empty, schema-valid case. The audit log starts empty: the caller appends
 * the 'case.created' entry with appendAudit (which is async).
 */
export function newCaseState(input: { id: string; now: IsoUtc; ruleset: { version: string; sha256: string }; settings: CaseSettings }): CaseState {
  const s = input.settings;
  return {
    id: input.id,
    createdAt: input.now,
    subject: { marks: [], primaryDomain: '', owner: '', rights: [] },
    sender: { name: '', title: '', organization: '', email: '', phone: '', address: '' },
    inventory: [],
    settings: {
      ...s,
      techniques: [...s.techniques],
      keyboards: [...s.keyboards],
      tlds: [...s.tlds],
      dictionary: [...s.dictionary],
      riskyKeywords: [...s.riskyKeywords],
    },
    domains: [],
    evidence: [],
    templates: [],
    ruleset: { version: input.ruleset.version, sha256: input.ruleset.sha256 },
    audit: [],
  };
}
