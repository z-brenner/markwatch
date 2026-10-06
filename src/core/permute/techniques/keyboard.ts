// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._replacement, renamed "keyboard"), layouts limited to the selected ones.

import { keyboardNeighbours } from '../keyboards';
import { chars, collect, replaceAt, type TechniqueFn } from './context';

/** Replaces each character with each of its keyboard neighbours in the selected layouts: "ab" (qwerty) → qb, wb, sb, zb, av, ag, ah, an. */
export const keyboard: TechniqueFn = (label, ctx) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => {
      for (const n of keyboardNeighbours(c, ctx.keyboards)) add(replaceAt(cs, i, n));
    });
  });
};
