// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._transposition), ordered output instead of a set.

import { chars, collect, type TechniqueFn } from './context';

/** Swaps each pair of adjacent characters: "abc" → bac, acb. */
export const transposition: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    for (let i = 0; i < cs.length - 1; i++) {
      add(cs.slice(0, i).join('') + (cs[i + 1] ?? '') + (cs[i] ?? '') + cs.slice(i + 2).join(''));
    }
  });
};
