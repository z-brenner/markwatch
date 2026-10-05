// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._subdomain, renamed "dot-insertion").

import { chars, collect, insertAt, type TechniqueFn } from './context';

/**
 * Inserts "." inside the label: "acme" → a.cme, ac.me. As in dnstwist, never
 * before the last character and never next to "-" or ".". Each result spans two
 * labels, so it usually belongs to a different registrable domain
 * ("ac.me.com" lives under "me.com"); the engine computes that.
 */
export const dotInsertion: TechniqueFn = (label) => {
  const cs = chars(label);
  const sep = (c: string | undefined) => c === '-' || c === '.';
  return collect(label, (add) => {
    for (let i = 1; i < cs.length - 1; i++) {
      if (!sep(cs[i]) && !sep(cs[i - 1])) add(insertAt(cs, i, '.'));
    }
  });
};
