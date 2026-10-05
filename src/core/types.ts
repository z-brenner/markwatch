// Shared domain types. Every module builds against these contracts; change
// them deliberately, because the case-file schema (core/casefile) mirrors them.

/** ISO-8601 timestamp in UTC, always ending in "Z". */
export type IsoUtc = string;

// ───────────────────────────── Discovery ─────────────────────────────

/** Canonical technique order. Also the priority order used when applying the cap. */
export const TECHNIQUES = [
  'original',
  'homoglyph',
  'cyrillic',
  'bitsquat',
  'keyboard',
  'insertion',
  'omission',
  'repetition',
  'transposition',
  'vowel-swap',
  'replacement',
  'hyphenation',
  'dot-insertion',
  'plural',
  'numeral-swap',
  'dictionary',
  'tld-swap',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export type DiscoverySource = 'permutation' | 'ct' | 'manual';

export interface Candidate {
  /** ASCII (punycode) FQDN, lowercase, no trailing dot. */
  domain: string;
  /** Unicode display form. */
  unicode: string;
  /** Registrable domain (eTLD+1), ASCII. Resolution happens at this level. */
  registrable: string;
  /** Techniques that produced this candidate, in TECHNIQUES order. Empty for CT/manual-only. */
  techniques: Technique[];
  /** Seed labels that produced this candidate (e.g. "acme", "acmewidgets"). */
  seeds: string[];
  sources: DiscoverySource[];
}

export type KeyboardLayout = 'qwerty' | 'qwertz' | 'azerty';

export interface PermutationOptions {
  /** Seed labels (no TLD), already lowercase. */
  seeds: string[];
  /** TLD of the primary domain (may be multi-label, e.g. "co.uk"). */
  baseSuffix: string;
  techniques: Technique[];
  keyboards: KeyboardLayout[];
  /** TLDs used for tld-swap (without leading dot). */
  tlds: string[];
  /** Words used for dictionary combos. */
  dictionary: string[];
  /** Maximum number of candidates kept. Default 5000. */
  cap: number;
}

export interface TechniqueStats {
  generated: number;
  kept: number;
}

export interface PermutationResult {
  candidates: Candidate[];
  /** Distinct valid candidates before the cap. */
  generated: number;
  kept: number;
  droppedByCap: number;
  perTechnique: Partial<Record<Technique, TechniqueStats>>;
}

// ───────────────────────────── Inventory ─────────────────────────────

export type InventoryKind = 'owned' | 'authorized';

export interface InventoryEntry {
  /** Registrable domain ("acme.com") or wildcard ("*.acme.com"). Stored ASCII. */
  pattern: string;
  kind: InventoryKind;
  /** Authorized third party name (licensee, agency…). */
  party?: string;
  note?: string;
}

// ───────────────────────────── Lookups ─────────────────────────────

export type RRType = 'NS' | 'A' | 'AAAA' | 'MX' | 'TXT' | 'SOA' | 'CNAME';
export const RR_CODES: Record<RRType, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };

export interface DnsRecord {
  name: string;
  /** Numeric RR type as returned by DoH (e.g. 2 for NS). */
  type: number;
  ttl: number;
  /** Record data with surrounding quotes removed for TXT. */
  data: string;
}

export type DnsResolver = 'cloudflare' | 'google' | 'manual';

export interface DnsAnswer {
  name: string;
  type: RRType;
  /** DNS RCODE: 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN, others possible. */
  rcode: number;
  /** DNSSEC authenticated data bit. */
  ad: boolean;
  answers: DnsRecord[];
  authority: DnsRecord[];
  resolver: DnsResolver;
  /** Extended DNS error / resolver comment if present. */
  comment?: string;
}

export interface RdapContact {
  roles: string[];
  name?: string;
  org?: string;
  email: string[];
  tel: string[];
  country?: string;
  /** True when the registry/registrar marked contact data as redacted. */
  redacted: boolean;
}

export interface RdapRegistrar {
  name?: string;
  ianaId?: string;
  url?: string;
  abuseEmail: string[];
  abuseTel: string[];
}

export interface RdapDomain {
  ldhName: string;
  unicodeName?: string;
  handle?: string;
  status: string[];
  registered?: IsoUtc;
  expires?: IsoUtc;
  lastChanged?: IsoUtc;
  registrar?: RdapRegistrar;
  registrant?: RdapContact;
  nameservers: string[];
  /** Names/paths of fields declared redacted (RFC 9537), human-readable. */
  redactedFields: string[];
  /** RDAP server base URL that answered. */
  server: string;
}

export interface RdapNetwork {
  handle?: string;
  name?: string;
  startAddress?: string;
  endAddress?: string;
  cidr: string[];
  country?: string;
  /** Organisation holding the network (registrant entity name/org). */
  org?: string;
  abuseEmail: string[];
  server: string;
}

export interface CtEntry {
  id: number;
  commonName: string;
  /** All names on the certificate (SANs), lowercase, may include wildcards. */
  names: string[];
  issuer: string;
  notBefore: IsoUtc;
  notAfter: IsoUtc;
  entryTimestamp?: IsoUtc;
}

export type LookupKind = 'dns' | 'rdap-domain' | 'rdap-ip' | 'ct' | 'abuse';

/**
 * Why a lookup produced no readable answer. A blocked lookup must NEVER be
 * rendered as "no data found".
 *  - csp:           our own Content-Security-Policy blocked the host
 *  - cors_or_error: server reachable but its response was unreadable (no CORS
 *                   header; often an error status such as 429/5xx sent without CORS)
 *  - unreachable:   network failure (DNS, TLS, connection)
 *  - timeout:       no response within the time limit
 *  - rate_limited:  readable 429 response
 *  - http_error:    readable non-2xx response that is not an authoritative "not found"
 *  - unsupported:   no service exists for this query (e.g. TLD without RDAP)
 *  - cancelled:     the user cancelled the run
 *  - parse_error:   readable response we could not parse
 */
export type BlockReason =
  | 'csp'
  | 'cors_or_error'
  | 'unreachable'
  | 'timeout'
  | 'rate_limited'
  | 'http_error'
  | 'unsupported'
  | 'cancelled'
  | 'parse_error';

interface LookupBase {
  kind: LookupKind;
  /** What was asked, e.g. "acme-login.com NS" or "93.184.216.34". */
  query: string;
  /** Human-readable source, e.g. "cloudflare-dns.com" or "rdap.verisign.com". */
  source: string;
  /** Request URL when one was made. */
  url?: string;
  at: IsoUtc;
}

export type LookupResult<T> =
  | (LookupBase & { status: 'ok'; data: T; /** Raw response text (truncated), kept as evidence. */ raw?: string })
  | (LookupBase & { status: 'not_found'; /** What the authoritative source said. */ evidence: string })
  | (LookupBase & { status: 'blocked'; reason: BlockReason; detail: string; /** Opens the same lookup in a new tab. */ manualUrl?: string })
  | (LookupBase & { status: 'manual'; data: T; pastedText: string });

// ───────────────────────────── Facts & enrichment ─────────────────────────────

export type RegistrationVerdict =
  | 'registered'
  | 'registered_broken_dns'
  | 'probably_unregistered'
  | 'not_delegated'
  | 'available'
  | 'blocked'
  | 'unknown';

export type ProviderRole = 'dns' | 'web' | 'cdn' | 'mail' | 'parking' | 'registrar';

export interface ProviderMatch {
  id: string;
  name: string;
  role: ProviderRole;
  /** Why we think so, e.g. "NS ends with .ns.cloudflare.com". */
  evidence: string;
  abuseUrl?: string;
  abuseEmail?: string;
  /** For CDN/reverse proxies: the true origin host is hidden behind it. */
  hidesOrigin?: boolean;
  /** Provider has a trademark complaint process (parking companies). */
  trademarkComplaintUrl?: string;
}

export interface DomainFacts {
  verdict: RegistrationVerdict;
  verdictReason: string;
  ns: string[];
  a: string[];
  aaaa: string[];
  mx: string[];
  txt: string[];
  wildcard?: boolean;
  dnssecFailure?: boolean;
  rdap?: RdapDomain;
  /** IP → network. */
  networks: Record<string, RdapNetwork>;
  /** IP → abuse emails from the Abusix contact DB. */
  abusix: Record<string, string[]>;
  providers: ProviderMatch[];
  ct: CtEntry[];
}

// ───────────────────────────── Scoring ─────────────────────────────

export interface ScoreItem {
  ruleId: string;
  points: number;
  reason: string;
}

export interface Score {
  total: number;
  items: ScoreItem[];
  rulesetVersion: string;
}

// ───────────────────────────── Classification & routing ─────────────────────────────

export const CLASSIFICATIONS = [
  'phishing_malware',
  'copied_content',
  'cybersquatting',
  'parked_ads',
  'for_sale',
  'fair_use',
  'authorized_noncompliant',
  'unrelated',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  phishing_malware: 'Phishing or malware',
  copied_content: 'Copied content',
  cybersquatting: 'Cybersquatting, no content',
  parked_ads: 'Parked with ads',
  for_sale: 'Offered for sale',
  fair_use: 'Possible fair use or criticism',
  authorized_noncompliant: 'Authorized but noncompliant',
  unrelated: 'Unrelated',
};

export const BUILTIN_TEMPLATE_IDS = [
  'registrar-abuse',
  'host-abuse',
  'dmca-notice',
  'demand-letter',
  'disclosure-request',
  'udrp-annex',
  'compliance-note',
] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];
/** Built-in ids plus ids of templates imported at runtime. */
export type TemplateId = string;

export interface RouteContact {
  label: string;
  email: string[];
  url?: string;
  /** Where the contact came from, e.g. "RDAP rdap.verisign.com (registrar abuse role)". */
  source: string;
}

export interface RouteStep {
  id: string;
  title: string;
  explanation: string;
  contacts: RouteContact[];
  templates: TemplateId[];
}

export interface RouteEscalation {
  id: string;
  title: string;
  explanation: string;
  available: boolean;
  /** Why it is unavailable or what limits it. */
  note?: string;
}

export interface RouteWarning {
  id: string;
  level: 'info' | 'caution' | 'danger';
  text: string;
  dismissible: boolean;
}

export interface Route {
  classification: Classification;
  headline: string;
  why: string[];
  steps: RouteStep[];
  escalations: RouteEscalation[];
  warnings: RouteWarning[];
  /** If set, outbound templates stay locked until the user records this acknowledgment. */
  requiresAck?: { id: string; text: string };
  /** Templates allowed for this class (union over steps, after the ack lock is applied by the caller). */
  allowedTemplates: TemplateId[];
}

// ───────────────────────────── Drafting ─────────────────────────────

export type TemplateChannel = 'email' | 'portal' | 'internal' | 'letter';

export interface DraftRecord {
  id: string;
  templateId: TemplateId;
  createdAt: IsoUtc;
  /** User edits to the merged text, if any. */
  body: string;
  subject?: string;
  to?: string[];
  /** Merge fields the user explicitly dismissed, with their reasons. */
  dismissed: { field: string; reason: string }[];
  /** User-supplied values for merge fields. */
  values: Record<string, string>;
  exports: { at: IsoUtc; format: 'eml' | 'mailto' | 'copy' | 'txt'; sha256: string }[];
}

// ───────────────────────────── Evidence & audit ─────────────────────────────

export interface EvidenceFile {
  sha256: string;
  name: string;
  type: string;
  bytes: number;
  addedAt: IsoUtc;
  /** Domains this evidence relates to. */
  domains: string[];
  note?: string;
}

export type AuditType =
  | 'case.created'
  | 'case.imported'
  | 'case.exported'
  | 'settings.changed'
  | 'inventory.changed'
  | 'discovery.run'
  | 'lookup'
  | 'lookup.manual'
  | 'classification.set'
  | 'classification.cleared'
  | 'ack.recorded'
  | 'warning.dismissed'
  | 'evidence.added'
  | 'evidence.removed'
  | 'template.imported'
  | 'draft.created'
  | 'draft.field_dismissed'
  | 'draft.exported';

export interface AuditEntry {
  seq: number;
  at: IsoUtc;
  actor: 'user' | 'system';
  type: AuditType;
  payload: Record<string, unknown>;
  /** SHA-256 hex of the previous entry ("0"*64 for the first). */
  prevHash: string;
  /** SHA-256 hex over prevHash + canonical JSON of {seq, at, actor, type, payload}. */
  hash: string;
}

// ───────────────────────────── Case ─────────────────────────────

export interface MarkRight {
  /** Registration number as entered by the user. Never invented. */
  number: string;
  jurisdiction: string;
  classes?: string;
  firstUse?: string;
  note?: string;
}

export interface CaseSubject {
  marks: string[];
  primaryDomain: string;
  owner: string;
  rights: MarkRight[];
}

export interface SenderDetails {
  name: string;
  title: string;
  organization: string;
  email: string;
  phone: string;
  address: string;
}

export interface CaseSettings {
  cap: number;
  techniques: Technique[];
  keyboards: KeyboardLayout[];
  tlds: string[];
  dictionary: string[];
  riskyKeywords: string[];
  primaryResolver: 'cloudflare' | 'google';
  useAbusix: boolean;
  ctEnabled: boolean;
}

export interface DomainRecord {
  domain: string;
  unicode: string;
  registrable: string;
  techniques: Technique[];
  seeds: string[];
  sources: DiscoverySource[];
  /** Set when the domain matches the inventory; such domains are excluded from enforcement. */
  inventory?: { kind: InventoryKind; pattern: string; party?: string };
  lookups: LookupResult<unknown>[];
  facts?: DomainFacts;
  score?: Score;
  classification?: { value: Classification; at: IsoUtc; note?: string };
  acks: { id: string; at: IsoUtc; text: string }[];
  dismissedWarnings: string[];
  drafts: DraftRecord[];
  evidence: string[];
}

export interface ImportedTemplate {
  id: TemplateId;
  source: string;
  importedAt: IsoUtc;
  sha256: string;
}

export interface CaseState {
  id: string;
  createdAt: IsoUtc;
  subject: CaseSubject;
  sender: SenderDetails;
  inventory: InventoryEntry[];
  settings: CaseSettings;
  domains: DomainRecord[];
  evidence: EvidenceFile[];
  templates: ImportedTemplate[];
  ruleset: { version: string; sha256: string };
  audit: AuditEntry[];
}
