// Derived from ail-typo-squatting (https://github.com/typosquatter/ail-typo-squatting),
// Copyright (c) 2022 AIL project, David Cruciani, CIRCL, BSD 2-Clause License.
// Modified: ported to TypeScript (generator/replacement.py), hyphen added to the alphabet, position-major order.

import { chars, collect, replaceAt, type TechniqueFn } from './context';

const ALPHABET = [...'abcdefghijklmnopqrstuvwxyz0123456789-'];

/** Replaces each character with every other character of [a-z0-9-], position by position. */
export const replacement: TechniqueFn = (label) => {
  const cs = chars(label);
  return collect(label, (add) => {
    cs.forEach((c, i) => {
      for (const r of ALPHABET) if (r !== c) add(replaceAt(cs, i, r));
    });
  });
};
