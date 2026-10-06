import { describe, expect, it } from 'vitest';
import { dictionary } from '../../../src/core/permute/techniques/dictionary';

const ctx = (words: string[]) => ({ suffix: 'com', keyboards: [], tlds: [], dictionary: words });

describe('dictionary', () => {
  it('builds label-word, labelword, word-label, wordlabel for each word', () => {
    expect(dictionary('acme', ctx(['login', 'pay']))).toEqual([
      'acme-login',
      'acmelogin',
      'login-acme',
      'loginacme',
      'acme-pay',
      'acmepay',
      'pay-acme',
      'payacme',
    ]);
  });
  it('skips a word the label already starts and ends with', () => {
    expect(dictionary('pay', ctx(['pay', 'app']))).toEqual(['pay-app', 'payapp', 'app-pay', 'apppay']);
  });
  it('emits nothing for an empty dictionary', () => {
    expect(dictionary('acme', ctx([]))).toEqual([]);
  });
});
