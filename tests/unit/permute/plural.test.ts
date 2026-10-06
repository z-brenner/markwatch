import { describe, expect, it } from 'vitest';
import { plural } from '../../../src/core/permute/techniques/plural';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('plural', () => {
  it('pluralizes the whole label', () => {
    expect(plural('acme', ctx)).toEqual(['acmes']);
    expect(plural('box', ctx)).toEqual(['boxes']);
    expect(plural('a', ctx)).toEqual(['as']);
  });
  it('pluralizes after interior characters, as dnstwist does for compounds', () => {
    expect(plural('bankofamerica', ctx)).toEqual([
      'banskofamerica',
      'banksofamerica',
      'bankosfamerica',
      'bankofsamerica',
      'bankofasmerica',
      'bankofamserica',
      'bankofamesrica',
      'bankofamersica',
      'bankofamerisca',
      'bankofamericas',
    ]);
  });
  it('uses "es" after s, x and z', () => {
    expect(plural('glassdoor', ctx)).toContain('glassesdoor');
    expect(plural('fizz', ctx)).toEqual(['fizzes']);
  });
});
