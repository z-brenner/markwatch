import type { Technique } from '../../types';
import type { TechniqueFn } from './context';
import { bitsquat } from './bitsquat';
import { cyrillic } from './cyrillic';
import { dictionary } from './dictionary';
import { dotInsertion } from './dot-insertion';
import { homoglyph } from './homoglyph';
import { hyphenation } from './hyphenation';
import { insertion } from './insertion';
import { keyboard } from './keyboard';
import { numeralSwap } from './numeral-swap';
import { omission } from './omission';
import { plural } from './plural';
import { repetition } from './repetition';
import { replacement } from './replacement';
import { tldSwap } from './tld-swap';
import { transposition } from './transposition';
import { vowelSwap } from './vowel-swap';

export type { TechniqueContext, TechniqueFn } from './context';

export const TECHNIQUE_FNS: Record<Exclude<Technique, 'original'>, TechniqueFn> = {
  homoglyph,
  cyrillic,
  bitsquat,
  keyboard,
  insertion,
  omission,
  repetition,
  transposition,
  'vowel-swap': vowelSwap,
  replacement,
  hyphenation,
  'dot-insertion': dotInsertion,
  plural,
  'numeral-swap': numeralSwap,
  dictionary,
  'tld-swap': tldSwap,
};
