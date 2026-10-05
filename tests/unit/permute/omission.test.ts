import { describe, expect, it } from 'vitest';
import { omission } from '../../../src/core/permute/techniques/omission';

const ctx = { suffix: 'com', keyboards: [], tlds: [], dictionary: [] };

describe('omission', () => {
  it('deletes each character in order', () => {
    expect(omission('abc', ctx)).toEqual(['bc', 'ac', 'ab']);
  });
  it('dedupes repeated characters', () => {
    expect(omission('aab', ctx)).toEqual(['ab', 'aa']);
  });
  it('emits nothing for a 1-char label (no empty label)', () => {
    expect(omission('a', ctx)).toEqual([]);
  });
  it('works per code point on IDN labels', () => {
    expect(omission('café', ctx)).toEqual(['afé', 'cfé', 'caé', 'caf']);
  });
  it('can expose a hyphen at the edge (engine validation drops it)', () => {
    expect(omission('a-b', ctx)).toEqual(['-b', 'ab', 'a-']);
  });
});
