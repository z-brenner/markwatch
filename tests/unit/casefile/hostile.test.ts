import { describe, expect, it } from 'vitest';
import { lookupResultSchema, domainRecordSchema } from '../../../src/core/casefile/schema';

const base = { kind: 'rdap-domain', query: 'x.com', source: 's', at: '2026-10-05T00:00:00.000Z' } as const;

describe('crafted case files are refused', () => {
  it('blocked lookups cannot carry non-https manual links', () => {
    for (const manualUrl of ['ms-msdt:/id PCWDiagnostic', 'javascript:alert(1)', 'data:text/html,x', 'http://evil.example/']) {
      expect(lookupResultSchema.safeParse({ ...base, status: 'blocked', reason: 'cors_or_error', detail: 'd', manualUrl }).success).toBe(false);
    }
    expect(lookupResultSchema.safeParse({ ...base, status: 'blocked', reason: 'cors_or_error', detail: 'd', manualUrl: 'https://lookup.icann.org/' }).success).toBe(true);
  });

  it('lookup data must match its kind', () => {
    expect(lookupResultSchema.safeParse({ ...base, kind: 'dns', status: 'ok', data: { answers: 'boom' } }).success).toBe(false);
    expect(lookupResultSchema.safeParse({ ...base, status: 'manual', pastedText: 'p', data: { ldhName: 'x.com' } }).success).toBe(false);
    expect(lookupResultSchema.safeParse({ ...base, kind: 'abuse', status: 'ok', data: [42] }).success).toBe(false);
    expect(
      lookupResultSchema.safeParse({ ...base, kind: 'dns', status: 'ok', data: { name: 'x.com', type: 'NS', rcode: 0, ad: false, answers: [], authority: [], resolver: 'google' } }).success,
    ).toBe(true);
  });

  it('provider links in facts must be https', () => {
    const rec = {
      domain: 'x.com',
      unicode: 'x.com',
      registrable: 'x.com',
      techniques: [],
      seeds: [],
      sources: ['manual'],
      lookups: [],
      acks: [],
      dismissedWarnings: [],
      drafts: [],
      evidence: [],
      facts: { verdict: 'registered', verdictReason: 'r', ns: [], a: [], aaaa: [], mx: [], txt: [], networks: {}, abusix: {}, ct: [], providers: [{ id: 'cf', name: 'Cloudflare', role: 'cdn', evidence: 'e', abuseUrl: 'javascript:alert(1)' }] },
    };
    expect(domainRecordSchema.safeParse(rec).success).toBe(false);
  });
});
