import { describe, expect, it } from 'vitest';
import { keyboard } from '../../../src/core/permute/techniques/keyboard';
import { keyboardNeighbours } from '../../../src/core/permute/keyboards';
import type { KeyboardLayout } from '../../../src/core/types';

const ctx = (keyboards: KeyboardLayout[]) => ({ suffix: 'com', keyboards, tlds: [], dictionary: [] });

describe('keyboard', () => {
  it('replaces each character with its QWERTY neighbours', () => {
    expect(keyboard('ab', ctx(['qwerty']))).toEqual(['qb', 'wb', 'sb', 'zb', 'av', 'ag', 'ah', 'an']);
  });
  it('merges layouts in canonical order regardless of selection order', () => {
    expect(keyboard('a', ctx(['azerty', 'qwerty']))).toEqual(['q', 'w', 's', 'z', '2', '1']);
    expect(keyboard('a', ctx(['qwerty', 'azerty']))).toEqual(keyboard('a', ctx(['azerty', 'qwerty'])));
  });
  it('uses QWERTZ and AZERTY maps', () => {
    expect(keyboardNeighbours('t', ['qwertz'])).toEqual([...'6zgfr5']);
    expect(keyboardNeighbours('m', ['azerty'])).toEqual(['l', 'p']);
  });
  it('leaves characters that are not on the keyboard alone', () => {
    expect(keyboard('a-', ctx(['qwerty']))).toEqual(['q-', 'w-', 's-', 'z-']);
    expect(keyboard('é', ctx(['qwerty']))).toEqual([]);
  });
  it('emits nothing without a layout', () => {
    expect(keyboard('acme', ctx([]))).toEqual([]);
  });
});
