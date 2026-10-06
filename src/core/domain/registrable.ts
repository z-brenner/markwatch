// Registrable-domain (eTLD+1) logic and seed derivation. Resolution, grouping
// and inventory matching all happen at the registrable level.

import { parse } from 'tldts';
import punycode from 'punycode/punycode.js';
import { isAscii, isValidUnicodeLabel, normalizeDomain } from './normalize';

// Private suffixes (github.io, blogspot.com…) are deliberately ignored: a
// squat on foo.github.io is reported against github.io, whose operator is the
// party that can act on it.
const TLDTS_OPTS = { allowPrivateDomains: false, extractHostname: false } as const;

/**
 * Splits an ASCII hostname into subdomain, registrable label and public
 * suffix. Returns null when the name has no ICANN public suffix or is itself a
 * public suffix.
 */
export function splitDomain(ascii: string): { subdomain: string; label: string; suffix: string; registrable: string } | null {
  const r = parse(ascii, TLDTS_OPTS);
  if (r.isIcann !== true || !r.domain || !r.publicSuffix || !r.domainWithoutSuffix) return null;
  return { subdomain: r.subdomain ?? '', label: r.domainWithoutSuffix, suffix: r.publicSuffix, registrable: r.domain };
}

export function registrableDomain(ascii: string): string | null {
  return splitDomain(ascii)?.registrable ?? null;
}

// Letters that NFD does not decompose but have a conventional ASCII spelling.
const FOLD_EXTRA: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Strips diacritics (NFD + drop combining marks), then spells out a few undecomposable letters. */
export function foldToAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD_EXTRA[c] ?? c)
    .normalize('NFC');
}

/** Splits a mark into lowercase words. Apostrophes are dropped so "McDonald's" stays one word. */
function markWords(mark: string): string[] {
  return mark
    .normalize('NFC')
    .toLowerCase()
    .replace(/['\u2019\u02bc]/g, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Derives the permutation seeds: the primary domain's registrable label (in
 * Unicode form) first, then for each mark the joined and hyphen-joined word
 * forms, and for non-ASCII marks their ASCII-folded counterparts as well.
 * Only labels that can be registered are kept.
 */
export function markToSeeds(marks: string[], primaryDomain: string): string[] {
  const seeds: string[] = [];
  const add = (label: string) => {
    if (label && isValidUnicodeLabel(label) && !seeds.includes(label)) seeds.push(label);
  };

  const primary = normalizeDomain(primaryDomain);
  const split = primary ? splitDomain(primary.ascii) : null;
  if (split) add(punycode.toUnicode(split.label));

  for (const mark of marks) {
    const words = markWords(mark);
    if (words.length === 0) continue;
    const forms = [words.join(''), words.join('-')];
    for (const f of forms) add(f);
    if (!isAscii(forms[0] ?? '')) {
      for (const f of forms) {
        const folded = foldToAscii(f);
        if (isAscii(folded)) add(folded);
      }
    }
  }
  return seeds;
}
