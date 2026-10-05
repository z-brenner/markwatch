// Derived from ail-typo-squatting (https://github.com/typosquatter/ail-typo-squatting),
// Copyright (c) 2022 AIL project, David Cruciani, CIRCL, BSD 2-Clause License.
// Modified: ported to TypeScript (generator/numeralSwap.py), replaces each occurrence individually as well as
// all at once; the numeral groups are written for Markwatch.

import { collect, type TechniqueFn } from './context';

/** Spellings that read the same. Digit/letter lookalikes (0/o, 1/l) belong to homoglyph, not here. */
const GROUPS: readonly (readonly string[])[] = [
  ['one', '1'],
  ['two', '2', 'to', 'too'],
  ['three', '3'],
  ['four', '4', 'for'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8', 'ate'],
  ['nine', '9'],
  ['zero', '0'],
];

/** Swaps number words and digits: "acme4u" → acmefouru, acmeforu; "go2" → gotwo, goto, gotoo. */
export const numeralSwap: TechniqueFn = (label) =>
  collect(label, (add) => {
    for (const group of GROUPS) {
      for (const from of group) {
        const at: number[] = [];
        for (let i = label.indexOf(from); i >= 0; i = label.indexOf(from, i + 1)) at.push(i);
        for (const i of at) {
          for (const to of group) if (to !== from) add(label.slice(0, i) + to + label.slice(i + from.length));
        }
        if (at.length > 1) for (const to of group) if (to !== from) add(label.split(from).join(to));
      }
    }
  });
