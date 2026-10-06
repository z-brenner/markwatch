// Zod schemas for the case file (schema v1). These mirror the shared types in
// core/types.ts exactly; a compile-time check at the bottom of this file makes
// `tsc` fail if the two drift apart.
//
// Imported case files are untrusted. Every object is strict (unknown keys are
// rejected), every string and array has an upper bound, and timestamps/hashes
// have fixed formats. The bounds keep memory use predictable; the ZIP layer
// separately caps the total uncompressed size.

import { z } from 'zod';
import {
  CLASSIFICATIONS,
  TECHNIQUES,
  type AuditEntry,
  type AuditType,
  type CaseSettings,
  type CaseState,
  type DomainRecord,
  type EvidenceFile,
  type IsoUtc,
  type LookupResult,
} from '../types';

// Never let zod compile validators with new Function(): the app forbids eval,
// and under the CSP even zod's feature probe is reported as a violation.
z.config({ jitless: true });

export const CASE_SCHEMA_VERSION = 1;

// ───────────────────────────── Errors ─────────────────────────────

export type CaseImportErrorCode =
  | 'not_zip'
  | 'too_large'
  | 'too_many_entries'
  | 'missing_case_json'
  | 'invalid_json'
  | 'unsupported_version'
  | 'schema'
  | 'evidence_mismatch'
  | 'path';

/** Fatal problem with an imported case file. `code` is stable; `message` is for humans. */
export class CaseImportError extends Error {
  readonly code: CaseImportErrorCode;
  constructor(code: CaseImportErrorCode, message: string) {
    super(message);
    this.name = 'CaseImportError';
    this.code = code;
  }
}

// ───────────────────────────── Limits ─────────────────────────────

/** Upper bounds applied to imported (and exported) case files. */
export const SCHEMA_LIMITS = {
  /** Identifiers, domains, names, labels, emails, URLs. */
  short: 2_000,
  /** Free text: notes, explanations, reasons, addresses. */
  text: 100_000,
  /** Raw evidence text: lookup responses, pasted text, draft bodies. 1 MB. */
  raw: 1_000_000,
  domains: 50_000,
  inventory: 50_000,
  lookupsPerDomain: 2_000,
  evidence: 10_000,
  audit: 1_000_000,
  /** Generic list bound (techniques, seeds, emails, warnings…). */
  list: 10_000,
  /** Max nesting depth of case.json (guards recursive consumers against stack exhaustion). */
  jsonDepth: 100,
} as const;

const L = SCHEMA_LIMITS;

// ───────────────────────────── Primitives ─────────────────────────────

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const short = z.string().max(L.short);
const text = z.string().max(L.text);
const raw = z.string().max(L.raw);
const list = <T extends z.ZodType>(item: T, max: number = L.list) => z.array(item).max(max);

export const isoUtcSchema = z
  .string()
  .max(40)
  .regex(ISO_UTC_RE, 'Expected an ISO-8601 UTC timestamp ending in "Z"')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date');

export const sha256Schema = z.string().regex(SHA256_RE, 'Expected a lowercase hex SHA-256 (64 chars)');

const int = z.number().int();
const nonNegInt = int.nonnegative();
const finite = z.number().finite();

// ───────────────────────────── Enums ─────────────────────────────

/** Every AuditType, as a runtime list (checked against the type below). */
export const AUDIT_TYPES = [
  'case.created',
  'case.imported',
  'case.exported',
  'settings.changed',
  'inventory.changed',
  'discovery.run',
  'lookup',
  'lookup.manual',
  'classification.set',
  'classification.cleared',
  'ack.recorded',
  'warning.dismissed',
  'evidence.added',
  'evidence.removed',
  'template.imported',
  'draft.created',
  'draft.field_dismissed',
  'draft.exported',
] as const satisfies readonly AuditType[];

const technique = z.enum(TECHNIQUES);
const discoverySource = z.enum(['permutation', 'ct', 'manual']);
const keyboardLayout = z.enum(['qwerty', 'qwertz', 'azerty']);
const inventoryKind = z.enum(['owned', 'authorized']);
const lookupKind = z.enum(['dns', 'rdap-domain', 'rdap-ip', 'ct', 'abuse']);
const blockReason = z.enum(['csp', 'cors_or_error', 'unreachable', 'timeout', 'rate_limited', 'http_error', 'unsupported', 'cancelled', 'parse_error']);
const verdict = z.enum(['registered', 'registered_broken_dns', 'probably_unregistered', 'not_delegated', 'available', 'blocked', 'unknown']);
const providerRole = z.enum(['dns', 'web', 'cdn', 'mail', 'parking', 'registrar']);
const classification = z.enum(CLASSIFICATIONS);
const auditType = z.enum(AUDIT_TYPES);
const actor = z.enum(['user', 'system']);

// ───────────────────────────── Inventory ─────────────────────────────

export const inventoryEntrySchema = z.strictObject({
  pattern: short,
  kind: inventoryKind,
  party: short.optional(),
  note: text.optional(),
});

// ───────────────────────────── Lookups ─────────────────────────────

/**
 * URLs from an imported case file end up in links. Only https URLs are
 * accepted, so a crafted file cannot plant javascript:, data: or
 * protocol-handler links (e.g. ms-msdt:).
 */
const httpsUrl = z
  .string()
  .max(8_000)
  .refine((u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Expected an https URL');

const lookupBase = {
  kind: lookupKind,
  query: short,
  source: short,
  url: httpsUrl.optional(),
  at: isoUtcSchema,
};

// Lookup `data` is typed per kind below (lookupResultSchema); this is the shape check.
const lookupResultShape = z.discriminatedUnion('status', [
  z.strictObject({ ...lookupBase, status: z.literal('ok'), data: z.unknown(), raw: raw.optional() }),
  z.strictObject({ ...lookupBase, status: z.literal('not_found'), evidence: raw }),
  z.strictObject({ ...lookupBase, status: z.literal('blocked'), reason: blockReason, detail: text, manualUrl: httpsUrl.optional() }),
  z.strictObject({ ...lookupBase, status: z.literal('manual'), data: z.unknown(), pastedText: raw }),
]);

// ───────────────────────────── Facts ─────────────────────────────

const rdapContact = z.strictObject({
  roles: list(short, 100),
  name: short.optional(),
  org: short.optional(),
  email: list(short, 100),
  tel: list(short, 100),
  country: short.optional(),
  redacted: z.boolean(),
});

const rdapRegistrar = z.strictObject({
  name: short.optional(),
  ianaId: short.optional(),
  url: short.optional(),
  abuseEmail: list(short, 100),
  abuseTel: list(short, 100),
});

const rdapDomain = z.strictObject({
  ldhName: short,
  unicodeName: short.optional(),
  handle: short.optional(),
  status: list(short, 100),
  registered: isoUtcSchema.optional(),
  expires: isoUtcSchema.optional(),
  lastChanged: isoUtcSchema.optional(),
  registrar: rdapRegistrar.optional(),
  registrant: rdapContact.optional(),
  nameservers: list(short, 100),
  redactedFields: list(short, 1_000),
  server: short,
});

const rdapNetwork = z.strictObject({
  handle: short.optional(),
  name: short.optional(),
  startAddress: short.optional(),
  endAddress: short.optional(),
  cidr: list(short, 1_000),
  country: short.optional(),
  org: short.optional(),
  abuseEmail: list(short, 100),
  server: short,
});

const providerMatch = z.strictObject({
  id: short,
  name: short,
  role: providerRole,
  evidence: text,
  abuseUrl: httpsUrl.optional(),
  abuseEmail: short.optional(),
  hidesOrigin: z.boolean().optional(),
  trademarkComplaintUrl: httpsUrl.optional(),
});

const ctEntry = z.strictObject({
  id: finite,
  commonName: short,
  names: list(short, 5_000),
  issuer: text,
  notBefore: isoUtcSchema,
  notAfter: isoUtcSchema,
  entryTimestamp: isoUtcSchema.optional(),
});

const dnsRecord = z.strictObject({ name: short, type: finite, ttl: finite, data: text });
const dnsAnswer = z.strictObject({
  name: short,
  type: z.enum(['NS', 'A', 'AAAA', 'MX', 'TXT', 'SOA', 'CNAME']),
  rcode: finite,
  ad: z.boolean(),
  answers: list(dnsRecord, 10_000),
  authority: list(dnsRecord, 1_000),
  resolver: z.enum(['cloudflare', 'google', 'manual']),
  comment: text.optional(),
});

/** What `data` must look like for each lookup kind. */
const LOOKUP_DATA = {
  dns: dnsAnswer,
  'rdap-domain': rdapDomain,
  'rdap-ip': rdapNetwork,
  ct: list(ctEntry, 50_000),
  abuse: list(short, 100),
} as const;

/**
 * Lookup results with their `data` validated per kind. Facts and scores are
 * derived from this data, so a crafted case file must not be able to smuggle
 * in shapes the app would crash on.
 */
export const lookupResultSchema = lookupResultShape.superRefine((l, ctx) => {
  if (l.status !== 'ok' && l.status !== 'manual') return;
  const r = LOOKUP_DATA[l.kind].safeParse(l.data);
  if (!r.success) {
    for (const issue of r.error.issues.slice(0, 5)) ctx.addIssue({ code: 'custom', path: ['data', ...issue.path], message: issue.message });
  }
});

const domainFacts = z.strictObject({
  verdict,
  verdictReason: text,
  ns: list(short, 1_000),
  a: list(short, 1_000),
  aaaa: list(short, 1_000),
  mx: list(short, 1_000),
  txt: list(text, 1_000),
  wildcard: z.boolean().optional(),
  dnssecFailure: z.boolean().optional(),
  rdap: rdapDomain.optional(),
  networks: z.record(short, rdapNetwork),
  abusix: z.record(short, list(short, 100)),
  providers: list(providerMatch, 1_000),
  ct: list(ctEntry, 50_000),
});

// ───────────────────────────── Scoring, drafting ─────────────────────────────

const score = z.strictObject({
  total: finite,
  items: list(z.strictObject({ ruleId: short, points: finite, reason: text }), 1_000),
  rulesetVersion: short,
});

const draftRecord = z.strictObject({
  id: short,
  templateId: short,
  createdAt: isoUtcSchema,
  body: raw,
  subject: text.optional(),
  to: list(short, 1_000).optional(),
  dismissed: list(z.strictObject({ field: short, reason: text }), 1_000),
  values: z.record(short, text),
  exports: list(z.strictObject({ at: isoUtcSchema, format: z.enum(['eml', 'mailto', 'copy', 'txt']), sha256: sha256Schema })),
});

// ───────────────────────────── Domain ─────────────────────────────

export const domainRecordSchema = z.strictObject({
  domain: short,
  unicode: short,
  registrable: short,
  techniques: list(technique, 1_000),
  seeds: list(short, 1_000),
  sources: list(discoverySource, 100),
  inventory: z.strictObject({ kind: inventoryKind, pattern: short, party: short.optional() }).optional(),
  lookups: list(lookupResultSchema, L.lookupsPerDomain),
  facts: domainFacts.optional(),
  score: score.optional(),
  classification: z.strictObject({ value: classification, at: isoUtcSchema, note: text.optional() }).optional(),
  acks: list(z.strictObject({ id: short, at: isoUtcSchema, text })),
  dismissedWarnings: list(short),
  drafts: list(draftRecord, 1_000),
  evidence: list(sha256Schema),
});

// ───────────────────────────── Evidence & audit ─────────────────────────────

export const evidenceFileSchema = z.strictObject({
  sha256: sha256Schema,
  name: z.string().max(1_000),
  type: z.string().max(255),
  bytes: nonNegInt,
  addedAt: isoUtcSchema,
  domains: list(short, L.domains),
  note: text.optional(),
});

export const auditEntrySchema = z.strictObject({
  seq: int.positive(),
  at: isoUtcSchema,
  actor,
  type: auditType,
  payload: z.record(z.string().max(L.short), z.unknown()),
  prevHash: sha256Schema,
  hash: sha256Schema,
});

// ───────────────────────────── Case ─────────────────────────────

export const caseSubjectSchema = z.strictObject({
  marks: list(short, 1_000),
  primaryDomain: short,
  owner: short,
  rights: list(
    z.strictObject({
      number: short,
      jurisdiction: short,
      classes: short.optional(),
      firstUse: short.optional(),
      note: text.optional(),
    }),
    1_000,
  ),
});

export const senderDetailsSchema = z.strictObject({
  name: short,
  title: short,
  organization: short,
  email: short,
  phone: short,
  address: text,
});

export const caseSettingsSchema = z.strictObject({
  cap: nonNegInt.max(1_000_000),
  techniques: list(technique, 1_000),
  keyboards: list(keyboardLayout, 100),
  tlds: list(short),
  dictionary: list(short),
  riskyKeywords: list(short),
  primaryResolver: z.enum(['cloudflare', 'google']),
  useAbusix: z.boolean(),
  ctEnabled: z.boolean(),
});

export const caseStateSchema = z
  .strictObject({
    id: short,
    createdAt: isoUtcSchema,
    subject: caseSubjectSchema,
    sender: senderDetailsSchema,
    inventory: list(inventoryEntrySchema, L.inventory),
    settings: caseSettingsSchema,
    domains: list(domainRecordSchema, L.domains),
    evidence: list(evidenceFileSchema, L.evidence),
    templates: list(z.strictObject({ id: short, source: text, importedAt: isoUtcSchema, sha256: sha256Schema }), 1_000),
    ruleset: z.strictObject({ version: short, sha256: sha256Schema }),
    audit: list(auditEntrySchema, L.audit),
  })
  .superRefine((c, ctx) => {
    // Evidence is addressed by hash; duplicates would collide in the ZIP.
    const seen = new Set<string>();
    c.evidence.forEach((e, i) => {
      if (seen.has(e.sha256)) ctx.addIssue({ code: 'custom', path: ['evidence', i, 'sha256'], message: 'Duplicate evidence hash' });
      seen.add(e.sha256);
    });
  });

// ───────────────────────────── Case file (case.json) ─────────────────────────────

export const caseFileSchema = z.strictObject({
  schemaVersion: z.literal(CASE_SCHEMA_VERSION),
  app: z.strictObject({ name: z.literal('Markwatch'), version: short, buildHash: short.optional() }),
  exportedAt: isoUtcSchema,
  case: caseStateSchema,
});

export interface CaseFileJson {
  schemaVersion: 1;
  app: { name: 'Markwatch'; version: string; buildHash?: string };
  exportedAt: IsoUtc;
  case: CaseState;
}

// ───────────────────────────── Manifest ─────────────────────────────

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(CASE_SCHEMA_VERSION),
  exportedAt: isoUtcSchema,
  files: list(z.strictObject({ path: z.string().max(1_024), sha256: sha256Schema, bytes: nonNegInt }), L.evidence + 10),
  caseJsonSha256: sha256Schema,
  /** Evidence hashes listed in case.json whose bytes were not available at export time. */
  missingEvidence: list(sha256Schema, L.evidence).optional(),
});

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface Manifest {
  schemaVersion: 1;
  exportedAt: IsoUtc;
  files: ManifestFile[];
  caseJsonSha256: string;
  missingEvidence?: string[];
}

// ───────────────────────────── Issue formatting ─────────────────────────────

/** "case.domains[0].lookups[1].at: message" for the first `max` issues. */
export function formatZodIssues(error: z.ZodError, max = 5): string {
  const parts = error.issues.slice(0, max).map((iss) => {
    let p = '';
    for (const seg of iss.path) p += typeof seg === 'number' ? `[${seg}]` : `${p ? '.' : ''}${String(seg)}`;
    return `${p || '(root)'}: ${iss.message}`;
  });
  const more = error.issues.length > max ? ` (+${error.issues.length - max} more)` : '';
  return parts.join('; ') + more;
}

// ───────────────────────────── Compile-time drift checks ─────────────────────────────
// If CaseState (or any nested type) changes and this schema does not, these
// lines fail to compile. Simplify flattens intersections so structurally
// identical types compare equal.

type Simplify<T> = T extends object ? { [K in keyof T]: Simplify<T[K]> } : T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _CaseStateMatches = Assert<Equals<Simplify<z.infer<typeof caseStateSchema>>, Simplify<CaseState>>>;
export type _CaseFileMatches = Assert<Equals<Simplify<z.infer<typeof caseFileSchema>>, Simplify<CaseFileJson>>>;
export type _ManifestMatches = Assert<Equals<Simplify<z.infer<typeof manifestSchema>>, Simplify<Manifest>>>;
export type _DomainMatches = Assert<Equals<Simplify<z.infer<typeof domainRecordSchema>>, Simplify<DomainRecord>>>;
export type _LookupMatches = Assert<Equals<Simplify<z.infer<typeof lookupResultSchema>>, Simplify<LookupResult<unknown>>>>;
export type _AuditMatches = Assert<Equals<Simplify<z.infer<typeof auditEntrySchema>>, Simplify<AuditEntry>>>;
export type _EvidenceMatches = Assert<Equals<Simplify<z.infer<typeof evidenceFileSchema>>, Simplify<EvidenceFile>>>;
export type _SettingsMatches = Assert<Equals<Simplify<z.infer<typeof caseSettingsSchema>>, Simplify<CaseSettings>>>;
// AUDIT_TYPES must list every AuditType (the `satisfies` above checks the converse).
export type _AuditTypesComplete = Assert<Equals<(typeof AUDIT_TYPES)[number], AuditType>>;

// Belt and braces: plain two-way assignability, independent of the Equals trick.
export function _schemaToState(x: z.infer<typeof caseStateSchema>): CaseState {
  return x;
}
export function _stateToSchema(x: CaseState): z.infer<typeof caseStateSchema> {
  return x;
}
