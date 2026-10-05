// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._omission), ordered output instead of a set.

import { chars, collect, type TechniqueFn } from './context';

/** Deletes each character in turn: "abc" → bc, ac, ab. */
export const omission: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    for (let i = 0; i < cs.length; i++) add(cs.slice(0, i).join('') + cs.slice(i + 1).join(''));
  });
};
