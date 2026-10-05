// Transparent rules engine: (facts, rules) → total + one line item per rule
// that fired. Pure and synchronous; the ruleset hash is computed separately.
import { RULES, RULESET_VERSION, type Condition, type Rule } from '../../config/scoring.rules';
import { canonicalJson, sha256Hex } from '../util';
import type { DomainFacts, ProviderMatch, Score, ScoreItem, Technique } from '../types';

export interface ScoreInput {
  /** ASCII domain being scored. */
  domain: string;
  techniques: readonly Technique[];
  facts?: DomainFacts;
  /** Nameservers of the user's primary domain (lowercase, no trailing dot). */
  primaryNs: readonly string[];
  /** Mark owner's organisation name, as entered. */
  ownerName: string;
  riskyKeywords: readonly string[];
  now: Date;
}

interface Hit {
  vars: Record<string, string>;
  /** Overrides the rule's points (risky keywords are per-keyword). */
  points?: number;
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

function normOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|incorporated|llc|l\s?l\s?c|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|plc|bv|nv|srl|pty)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parkingProvider(facts: DomainFacts): ProviderMatch | undefined {
  return facts.providers.find((p) => p.role === 'parking');
}

/** The label portion(s) to search for keywords: everything left of the registrable suffix is fine, keywords rarely span dots. */
function keywordHits(domain: string, keywords: readonly string[]): string[] {
  const host = domain.toLowerCase();
  return keywords.filter((k) => k && host.includes(k.toLowerCase()));
}

function evaluate(c: Condition, input: ScoreInput): Hit | null {
  const f = input.facts;
  switch (c.kind) {
    case 'registeredWithinDays': {
      const d = daysSince(f?.rdap?.registered, input.now);
      return d !== undefined && d >= 0 && d <= c.days ? { vars: { days: String(d) } } : null;
    }
    case 'mxWithoutWeb':
      return f && f.mx.length > 0 && f.a.length === 0 && f.aaaa.length === 0 ? { vars: {} } : null;
    case 'mxWithWeb':
      return f && f.mx.length > 0 && (f.a.length > 0 || f.aaaa.length > 0) ? { vars: {} } : null;
    case 'parkingNameserver': {
      const p = f && parkingProvider(f);
      return p ? { vars: { provider: p.name } } : null;
    }
    case 'certificateWithinDays': {
      if (!f || f.ct.length === 0) return null;
      const newest = f.ct.reduce((a, b) => (Date.parse(b.notBefore) > Date.parse(a.notBefore) ? b : a));
      const d = daysSince(newest.notBefore, input.now);
      return d !== undefined && d >= 0 && d <= c.days ? { vars: { days: String(d) } } : null;
    }
    case 'techniqueAny': {
      const matched = c.techniques.filter((t) => input.techniques.includes(t));
      return matched.length ? { vars: { techniques: matched.join(', ') } } : null;
    }
    case 'riskyKeyword': {
      const hits = keywordHits(input.domain, input.riskyKeywords);
      return hits.length ? { vars: { keywords: hits.join(', ') }, points: Math.min(c.cap, hits.length * c.perKeyword) } : null;
    }
    case 'wildcardDns':
      return f?.wildcard ? { vars: {} } : null;
    case 'brokenDns':
      return f?.verdict === 'registered_broken_dns' ? { vars: {} } : null;
    case 'nameserversMatchPrimary': {
      if (!f || f.ns.length === 0 || input.primaryNs.length === 0) return null;
      const a = [...f.ns].map((s) => s.toLowerCase()).sort().join(',');
      const b = [...input.primaryNs].map((s) => s.toLowerCase()).sort().join(',');
      return a === b ? { vars: {} } : null;
    }
    case 'registrantMatchesOwner': {
      const r = f?.rdap?.registrant;
      const owner = normOrg(input.ownerName);
      if (!r || r.redacted || !owner) return null;
      const candidates = [r.org, r.name].filter((s): s is string => !!s).map(normOrg);
      return candidates.includes(owner) ? { vars: {} } : null;
    }
    case 'statusAny': {
      const st = (f?.rdap?.status ?? []).filter((s) => c.statuses.some((x) => x.toLowerCase() === s.toLowerCase().replace(/\s+/g, '')));
      return st.length ? { vars: { status: st.join(', ') } } : null;
    }
  }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function scoreDomain(input: ScoreInput, rules: readonly Rule[] = RULES, version: string = RULESET_VERSION): Score {
  const items: ScoreItem[] = [];
  const groupsUsed = new Set<string>();
  for (const rule of rules) {
    if (rule.group && groupsUsed.has(rule.group)) continue;
    const hit = evaluate(rule.when, input);
    if (!hit) continue;
    if (rule.group) groupsUsed.add(rule.group);
    items.push({ ruleId: rule.id, points: hit.points ?? rule.points, reason: fill(rule.reason, hit.vars) });
  }
  return { total: items.reduce((s, i) => s + i.points, 0), items, rulesetVersion: version };
}

export async function rulesetFingerprint(rules: readonly Rule[] = RULES, version: string = RULESET_VERSION): Promise<{ version: string; sha256: string }> {
  return { version, sha256: await sha256Hex(canonicalJson(rules)) };
}
