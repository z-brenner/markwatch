// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript; Fuzzer.qwerty/qwertz/azerty maps copied verbatim, plus a
// deterministic neighbour lookup over the selected layouts.

import type { KeyboardLayout } from '../types';

type KeyMap = Readonly<Record<string, string>>;

const QWERTY: KeyMap = {
  '1': '2q', '2': '3wq1', '3': '4ew2', '4': '5re3', '5': '6tr4', '6': '7yt5', '7': '8uy6', '8': '9iu7', '9': '0oi8', '0': 'po9',
  q: '12wa', w: '3esaq2', e: '4rdsw3', r: '5tfde4', t: '6ygfr5', y: '7uhgt6', u: '8ijhy7', i: '9okju8', o: '0plki9', p: 'lo0',
  a: 'qwsz', s: 'edxzaw', d: 'rfcxse', f: 'tgvcdr', g: 'yhbvft', h: 'ujnbgy', j: 'ikmnhu', k: 'olmji', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const QWERTZ: KeyMap = {
  '1': '2q', '2': '3wq1', '3': '4ew2', '4': '5re3', '5': '6tr4', '6': '7zt5', '7': '8uz6', '8': '9iu7', '9': '0oi8', '0': 'po9',
  q: '12wa', w: '3esaq2', e: '4rdsw3', r: '5tfde4', t: '6zgfr5', z: '7uhgt6', u: '8ijhz7', i: '9okju8', o: '0plki9', p: 'lo0',
  a: 'qwsy', s: 'edxyaw', d: 'rfcxse', f: 'tgvcdr', g: 'zhbvft', h: 'ujnbgz', j: 'ikmnhu', k: 'olmji', l: 'kop',
  y: 'asx', x: 'ysdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const AZERTY: KeyMap = {
  '1': '2a', '2': '3za1', '3': '4ez2', '4': '5re3', '5': '6tr4', '6': '7yt5', '7': '8uy6', '8': '9iu7', '9': '0oi8', '0': 'po9',
  a: '2zq1', z: '3esqa2', e: '4rdsz3', r: '5tfde4', t: '6ygfr5', y: '7uhgt6', u: '8ijhy7', i: '9okju8', o: '0plki9', p: 'lo0m',
  q: 'zswa', s: 'edxwqz', d: 'rfcxse', f: 'tgvcdr', g: 'yhbvft', h: 'ujnbgy', j: 'iknhu', k: 'olji', l: 'kopm', m: 'lp',
  w: 'sxq', x: 'wsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhj',
};

export const KEYBOARDS: Readonly<Record<KeyboardLayout, KeyMap>> = { qwerty: QWERTY, qwertz: QWERTZ, azerty: AZERTY };

/** Canonical layout order, so results do not depend on the order the user ticked layouts in. */
export const KEYBOARD_ORDER: readonly KeyboardLayout[] = ['qwerty', 'qwertz', 'azerty'];

/** Neighbours of `ch` across `layouts`, in canonical layout order then map order, deduplicated. */
export function keyboardNeighbours(ch: string, layouts: readonly KeyboardLayout[]): string[] {
  const out: string[] = [];
  for (const layout of KEYBOARD_ORDER) {
    if (!layouts.includes(layout)) continue;
    for (const n of KEYBOARDS[layout][ch] ?? '') if (!out.includes(n)) out.push(n);
  }
  return out;
}
