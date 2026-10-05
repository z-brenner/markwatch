import { describe, expect, it } from 'vitest';
import { numeralSwap } from '../../../src/core/permute/techniques/numeral-swap';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('numeral-swap', () => {
  it('spells out digits', () => {
    expect(numeralSwap('acme4u', ctx)).toEqual(['acmefouru', 'acmeforu']);
    expect(numeralSwap('go2', ctx)).toEqual(['gotwo', 'goto', 'gotoo']);
  });
  it('turns words into digits and siblings', () => {
    expect(numeralSwap('one1', ctx)).toEqual(['11', 'oneone']);
    expect(numeralSwap('eight', ctx)).toEqual(['8', 'ate']);
  });
  it('swaps each occurrence on its own and all occurrences together', () => {
    expect(numeralSwap('1and1', ctx)).toEqual(['oneand1', '1andone', 'oneandone']);
  });
  it('does not treat letter lookalikes (0/o, 1/l) as numerals', () => {
    expect(numeralSwap('acme', ctx)).toEqual([]);
    expect(numeralSwap('lo', ctx)).toEqual([]);
  });
});
