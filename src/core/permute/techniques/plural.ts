// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._plural), plus the plural of the whole label.

import { chars, collect, type TechniqueFn } from './context';

const pluralOf = (c: string | undefined) => (c === 's' || c === 'x' || c === 'z' ? 'es' : 's');

/**
 * Pluralizes after interior characters, as dnstwist does for compound labels
 * ("bankofamerica" → "banksofamerica"), and the whole label ("acme" → "acmes",
 * "box" → "boxes"), which dnstwist's interior-only range never produces.
 */
export const plural: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    for (let i = 2; i < cs.length - 2; i++) {
      add(cs.slice(0, i + 1).join('') + pluralOf(cs[i]) + cs.slice(i + 1).join(''));
    }
    if (cs.length > 0) add(label + pluralOf(cs[cs.length - 1]));
  });
};
