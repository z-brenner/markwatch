// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._repetition), ordered output instead of a set.

import { chars, collect, insertAt, type TechniqueFn } from './context';

/** Doubles each character in turn: "abc" → aabc, abbc, abcc. */
export const repetition: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => add(insertAt(cs, i, c)));
  });
};
