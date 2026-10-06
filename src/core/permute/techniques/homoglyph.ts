// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._homoglyph), deterministic iteration order instead of Python
// sets, suffix-to-repertoire lookup falls back to the last label, non-encodable results dropped.

import { isAscii, isValidUnicodeLabel } from '../../domain/normalize';
import { glyphsForSuffix, type GlyphTable } from '../glyphs';
import { chars, type TechniqueFn } from './context';

/** One round: replace each character, then each 2-character window (either char, or the pair). */
function mix(label: string, glyphs: GlyphTable, add: (v: string) => void): void {
  const cs = chars(label);
  const n = cs.length;
  const prefix = cs.map((_, i) => cs.slice(0, i).join(''));
  const suffix = cs.map((_, i) => cs.slice(i).join(''));
  suffix.push('');

  for (let i = 0; i < n; i++) {
    const gs = glyphs[cs[i] ?? ''];
    if (gs) for (const g of gs) add((prefix[i] ?? '') + g + (suffix[i + 1] ?? ''));
  }
  for (let i = 0; i < n - 1; i++) {
    const a = cs[i] ?? '';
    const b = cs[i + 1] ?? '';
    const win = a + b;
    const pre = prefix[i] ?? '';
    const suf = suffix[i + 2] ?? '';
    for (const c of a === b ? [a, win] : [a, b, win]) {
      const gs = glyphs[c];
      // As in dnstwist, a single-char key replaces every occurrence inside the window ("oo" → "00").
      if (gs) for (const g of gs) add(pre + win.split(c).join(g) + suf);
    }
  }
}

/**
 * Lookalike substitution in two rounds, like dnstwist: ASCII lookalikes
 * ("rn"→"m", "cl"→"d", "0"↔"o") always, plus the Unicode glyphs the suffix's
 * registry accepts (none for e.g. .uk or .us; Latin repertoires for .de, .fr…;
 * the full table for unlisted suffixes such as .com).
 */
export const homoglyph: TechniqueFn = (label, ctx) => {
  const glyphs = glyphsForSuffix(ctx.suffix);
  const round1 = new Set<string>();
  mix(label, glyphs, (v) => round1.add(v));
  const all = new Set(round1);
  for (const r of round1) mix(r, glyphs, (v) => all.add(v));
  all.delete(label);
  all.delete('');
  return [...all].filter((v) => isAscii(v) || isValidUnicodeLabel(v));
};
