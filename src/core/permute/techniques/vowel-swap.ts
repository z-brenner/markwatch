// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._vowel_swap), identity results skipped.

import { chars, collect, replaceAt, type TechniqueFn } from './context';

const VOWELS = ['a', 'e', 'i', 'o', 'u'];

/** Replaces each vowel with every other vowel: "bat" → bet, bit, bot, but. */
export const vowelSwap: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => {
      if (VOWELS.includes(c)) for (const v of VOWELS) add(replaceAt(cs, i, v));
    });
  });
};
