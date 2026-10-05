// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._dictionary), without the hyphen-part substitution variants.

import { collect, type TechniqueFn } from './context';

/** Combines the label with each dictionary word: acme-login, acmelogin, login-acme, loginacme. */
export const dictionary: TechniqueFn = (label, ctx) =>
  collect(label, (add) => {
    for (const word of ctx.dictionary) {
      if (!word || (label.startsWith(word) && label.endsWith(word))) continue;
      add(`${label}-${word}`);
      add(`${label}${word}`);
      add(`${word}-${label}`);
      add(`${word}${label}`);
    }
  });
