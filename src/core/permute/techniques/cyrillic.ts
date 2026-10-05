// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._cyrillic), suppressed for registries with a known non-Cyrillic repertoire.

import { idnRepertoire, LATIN_TO_CYRILLIC } from '../glyphs';
import { chars, type TechniqueFn } from './context';

/**
 * Rewrites the whole label in Cyrillic lookalikes ("acme" → "асме"). Emits
 * nothing unless every character has a Cyrillic twin, because a mixed-script
 * label is refused by most registries and flagged by browsers. Also emits
 * nothing for suffixes whose registry repertoire is known (dnstwist's
 * glyphs_idn_by_tld) and contains no Cyrillic.
 */
export const cyrillic: TechniqueFn = (label, ctx) => {
  if (idnRepertoire(ctx.suffix) !== undefined) return [];
  let out = '';
  for (const c of chars(label)) {
    const cyr = LATIN_TO_CYRILLIC[c];
    if (cyr === undefined) return [];
    out += cyr;
  }
  return out ? [out] : [];
};
