// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._insertion), layouts limited to the selected ones, and the last
// character is included (dnstwist stops one short).

import { keyboardNeighbours } from '../keyboards';
import { chars, collect, type TechniqueFn } from './context';

/** Inserts each character's keyboard neighbours before and after it: "a" (qwerty) → qa, aq, wa, aw, sa, as, za, az. */
export const insertion: TechniqueFn = (label, ctx) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => {
      const pre = cs.slice(0, i).join('');
      const suf = cs.slice(i + 1).join('');
      for (const n of keyboardNeighbours(c, ctx.keyboards)) {
        add(pre + n + c + suf);
        add(pre + c + n + suf);
      }
    });
  });
};
