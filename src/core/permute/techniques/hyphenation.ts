// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript (Fuzzer._hyphenation), no insertion next to an existing hyphen.
// Hyphen removal derived from ail-typo-squatting (https://github.com/typosquatter/ail-typo-squatting),
// Copyright (c) 2022 AIL project, David Cruciani, CIRCL, BSD 2-Clause License.
// Modified: ported to TypeScript (stripDash), removes each hyphen individually.

import { chars, collect, insertAt, type TechniqueFn } from './context';

/**
 * Inserts "-" at each interior position, then removes each existing hyphen:
 * "ab-c" → a-b-c, ab-c… and abc. Positions next to an existing hyphen are
 * skipped, since "a--b" is a doubled hyphen rather than a plausible typo.
 */
export const hyphenation: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    for (let i = 1; i < cs.length; i++) {
      if (cs[i - 1] !== '-' && cs[i] !== '-') add(insertAt(cs, i, '-'));
    }
    cs.forEach((c, i) => {
      if (c === '-') add(cs.slice(0, i).join('') + cs.slice(i + 1).join(''));
    });
  });
};
