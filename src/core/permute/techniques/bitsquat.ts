// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._bitsquatting), deduplicated ordered output.

import { chars, collect, replaceAt, type TechniqueFn } from './context';

const MASKS = [1, 2, 4, 8, 16, 32, 64, 128];
const ALLOWED = /^[a-z0-9-]$/;

/** Flips each bit of each character's code point and keeps results in [a-z0-9-]: "a" → c, e, i, q. */
export const bitsquat: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => {
      const code = c.codePointAt(0) ?? 0;
      for (const mask of MASKS) {
        const b = String.fromCodePoint(code ^ mask);
        if (ALLOWED.test(b)) add(replaceAt(cs, i, b));
      }
    });
  });
};
