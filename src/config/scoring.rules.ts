// ┌──────────────────────────────────────────────────────────────────────┐
// │ Markwatch scoring rules — the ONE file to edit to tune scoring.      │
// └──────────────────────────────────────────────────────────────────────┘
//
// A score only RANKS domains for review. It never classifies them; the user
// always decides. Every point shown in the UI carries the `reason` below.
//
// How rules work:
//  - Rules are evaluated in order. Each matching rule adds `points`.
//  - Rules sharing a `group` are mutually exclusive: only the FIRST matching
//    rule in a group counts (used for age bands).
//  - `reason` may use placeholders filled by the engine: {{days}}, {{techniques}},
//    {{keywords}}, {{provider}}, {{status}}.
//  - Weights are initial placeholders. Tune them on real data and bump
//    RULESET_VERSION; the version and a SHA-256 of these rules are written
//    into every case file so past scores stay reproducible.
//
// Editing safely: the `Condition` type below is checked by `tsc`, and
// tests/unit/score covers every condition kind.

import type { Technique } from '../core/types';

export const RULESET_VERSION = '2026-10-05.1';

export type Condition =
  /** Registry creation date is within N days (requires RDAP). */
  | { kind: 'registeredWithinDays'; days: number }
  /** MX records present and no A/AAAA records: mail-only setup typical of phishing/BEC. */
  | { kind: 'mxWithoutWeb' }
  /** MX records present alongside A/AAAA records. */
  | { kind: 'mxWithWeb' }
  /** Nameservers match a known parking provider (config/parking.ts). */
  | { kind: 'parkingNameserver' }
  /** A certificate for the domain was issued (notBefore) within N days (crt.sh). */
  | { kind: 'certificateWithinDays'; days: number }
  /** Candidate was produced by any of these techniques. */
  | { kind: 'techniqueAny'; techniques: Technique[] }
  /** Domain label contains a risky keyword; points are per keyword, capped. */
  | { kind: 'riskyKeyword'; perKeyword: number; cap: number }
  /** Zone answers for random subdomains. */
  | { kind: 'wildcardDns' }
  /** Resolver returned SERVFAIL (lame delegation or DNSSEC failure). */
  | { kind: 'brokenDns' }
  /** Nameservers are identical to the primary domain's nameservers. */
  | { kind: 'nameserversMatchPrimary' }
  /** Unredacted registrant organisation matches the mark owner's name. */
  | { kind: 'registrantMatchesOwner' }
  /** Registry status contains any of these EPP status values (case-insensitive). */
  | { kind: 'statusAny'; statuses: string[] };

export interface Rule {
  id: string;
  points: number;
  group?: string;
  when: Condition;
  reason: string;
}

export const RULES: readonly Rule[] = [
  // Registration age (mutually exclusive bands).
  { id: 'age-30d', group: 'age', points: 30, when: { kind: 'registeredWithinDays', days: 30 }, reason: 'Registered {{days}} days ago (within 30 days)' },
  { id: 'age-90d', group: 'age', points: 20, when: { kind: 'registeredWithinDays', days: 90 }, reason: 'Registered {{days}} days ago (within 90 days)' },
  { id: 'age-365d', group: 'age', points: 10, when: { kind: 'registeredWithinDays', days: 365 }, reason: 'Registered {{days}} days ago (within a year)' },

  // Mail and web setup (mutually exclusive).
  { id: 'mx-no-web', group: 'mail', points: 25, when: { kind: 'mxWithoutWeb' }, reason: 'Accepts email (MX) but has no website (no A/AAAA): typical of phishing or BEC setups' },
  { id: 'mx-with-web', group: 'mail', points: 5, when: { kind: 'mxWithWeb' }, reason: 'Accepts email (MX) and has a website' },

  { id: 'parking-ns', points: 10, when: { kind: 'parkingNameserver' }, reason: 'Nameservers belong to a parking provider ({{provider}})' },
  { id: 'recent-cert', points: 15, when: { kind: 'certificateWithinDays', days: 30 }, reason: 'TLS certificate issued {{days}} days ago (crt.sh)' },
  {
    id: 'visual-lookalike',
    points: 20,
    when: { kind: 'techniqueAny', techniques: ['homoglyph', 'cyrillic', 'bitsquat'] },
    reason: 'Visual or bit-level lookalike ({{techniques}})',
  },
  { id: 'risky-keyword', points: 15, when: { kind: 'riskyKeyword', perKeyword: 15, cap: 30 }, reason: 'Contains risky keyword(s): {{keywords}}' },
  { id: 'wildcard', points: 5, when: { kind: 'wildcardDns' }, reason: 'Wildcard DNS: answers for any subdomain' },
  { id: 'broken-dns', points: 5, when: { kind: 'brokenDns' }, reason: 'DNS lookups fail (SERVFAIL): lame delegation or DNSSEC failure, common on expired or hijacked domains' },

  // Negative signals: probably yours or already handled.
  { id: 'ns-match-primary', points: -40, when: { kind: 'nameserversMatchPrimary' }, reason: 'Uses the same nameservers as your primary domain: it may be yours, so check the inventory' },
  { id: 'registrant-is-owner', points: -50, when: { kind: 'registrantMatchesOwner' }, reason: 'Registrant organisation matches the mark owner: it may be yours, so check the inventory' },
  { id: 'on-hold', points: -10, when: { kind: 'statusAny', statuses: ['clientHold', 'serverHold'] }, reason: 'Registry status {{status}}: already suspended' },
];
