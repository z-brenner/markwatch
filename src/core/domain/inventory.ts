// Owned/authorized inventory: parsing the user's lists and matching candidates
// against them. A match removes the domain from enforcement, so matching errs
// on the side of the narrower reading of each entry.

import type { InventoryEntry } from '../types';
import { normalizeDomain } from './normalize';
import { registrableDomain } from './registrable';

/** Normalizes a list entry: a hostname or a "*.<hostname>" wildcard. Returns the ASCII form or null. */
function normalizePattern(raw: string): string | null {
  const s = raw.trim();
  if (s.startsWith('*.')) {
    const base = normalizeDomain(s.slice(2));
    return base ? `*.${base.ascii}` : null;
  }
  return normalizeDomain(s)?.ascii ?? null;
}

/**
 * Splits pasted text on newlines, commas, semicolons and whitespace. Accepts
 * URLs and "*.acme.com" wildcards. Valid entries come back normalized to
 * ASCII, deduplicated in first-seen order; invalid tokens come back verbatim.
 */
export function parseDomainList(text: string): { valid: string[]; invalid: string[] } {
  const valid = new Set<string>();
  const invalid = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const p = normalizePattern(token);
    if (p) valid.add(p);
    else invalid.add(token);
  }
  return { valid: [...valid], invalid: [...invalid] };
}

type Matcher = (domain: string, registrable: string | null) => boolean;

const isUnder = (domain: string, base: string) => domain === base || domain.endsWith(`.${base}`);

function compile(pattern: string): Matcher {
  const p = normalizePattern(pattern);
  if (!p) return () => false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return (d) => isUnder(d, base);
  }
  const reg = registrableDomain(p);
  // "acme.com" covers every host under the registrable domain.
  if (reg === p) return (_d, r) => r === p;
  // A deeper host ("shop.acme.com", or anything under a private suffix such as
  // "acme.github.io") covers only itself and its subdomains, never its siblings.
  if (reg) return (d) => isUnder(d, p);
  // A bare public suffix or an unknown TLD matches nothing.
  return () => false;
}

// Patterns are user input that may be unnormalized; compile each once.
const compiled = new Map<string, Matcher>();
function matcherFor(pattern: string): Matcher {
  let m = compiled.get(pattern);
  if (!m) {
    if (compiled.size > 10_000) compiled.clear();
    m = compile(pattern);
    compiled.set(pattern, m);
  }
  return m;
}

/**
 * Returns the inventory entry covering `domainAscii`, or null. "owned" wins
 * over "authorized" when both match; otherwise the first matching entry wins.
 */
export function matchInventory(domainAscii: string, inventory: InventoryEntry[]): InventoryEntry | null {
  const domain = normalizeDomain(domainAscii)?.ascii;
  if (!domain) return null;
  const reg = registrableDomain(domain);
  let authorized: InventoryEntry | null = null;
  for (const entry of inventory) {
    if (!matcherFor(entry.pattern)(domain, reg)) continue;
    if (entry.kind === 'owned') return entry;
    authorized ??= entry;
  }
  return authorized;
}
