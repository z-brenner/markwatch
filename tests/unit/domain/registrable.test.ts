import { describe, expect, it } from 'vitest';
import { markToSeeds, registrableDomain, splitDomain } from '../../../src/core/domain';

describe('splitDomain', () => {
  it('splits on the ICANN public suffix', () => {
    expect(splitDomain('www.acme.co.uk')).toEqual({ subdomain: 'www', label: 'acme', suffix: 'co.uk', registrable: 'acme.co.uk' });
    expect(splitDomain('acme.com')).toEqual({ subdomain: '', label: 'acme', suffix: 'com', registrable: 'acme.com' });
    expect(splitDomain('a.b.xn--caf-dma.fr')).toEqual({ subdomain: 'a.b', label: 'xn--caf-dma', suffix: 'fr', registrable: 'xn--caf-dma.fr' });
  });
  it('returns null for unknown TLDs and bare suffixes', () => {
    expect(splitDomain('acme.notatld')).toBeNull();
    expect(splitDomain('co.uk')).toBeNull();
    expect(splitDomain('com')).toBeNull();
  });
  it('ignores private suffixes', () => {
    expect(splitDomain('acme.github.io')?.registrable).toBe('github.io');
  });
});

describe('registrableDomain', () => {
  it('returns eTLD+1', () => {
    expect(registrableDomain('ex.ample.com')).toBe('ample.com');
    expect(registrableDomain('login.acme.com.br')).toBe('acme.com.br');
    expect(registrableDomain('acme.invalidtld')).toBeNull();
  });
});

describe('markToSeeds', () => {
  it('puts the primary label first, then joined and hyphenated mark forms', () => {
    expect(markToSeeds(['Acme Widgets'], 'acme.com')).toEqual(['acme', 'acmewidgets', 'acme-widgets']);
  });
  it('dedupes against the primary label', () => {
    expect(markToSeeds(['ACME'], 'https://www.acme.com/')).toEqual(['acme']);
  });
  it('adds IDN and ASCII-folded forms for non-ASCII marks', () => {
    expect(markToSeeds(['Café Noir'], 'noir.com')).toEqual(['noir', 'cafénoir', 'café-noir', 'cafenoir', 'cafe-noir']);
    expect(markToSeeds(['Café'], 'cafe.fr')).toEqual(['cafe', 'café']);
    expect(markToSeeds(['Straße'], 'example.de')).toEqual(['example', 'straße', 'strasse']);
  });
  it('uses the Unicode form of an IDN primary domain', () => {
    expect(markToSeeds([], 'xn--caf-dma.fr')).toEqual(['café']);
    expect(markToSeeds([], 'shop.acme.co.uk')).toEqual(['acme']);
  });
  it('drops apostrophes and splits on other punctuation', () => {
    expect(markToSeeds(["McDonald's"], 'mcdonalds.com')).toEqual(['mcdonalds']);
    expect(markToSeeds(['AT&T'], 'att.com')).toEqual(['att', 'at-t']);
  });
  it('keeps only valid labels', () => {
    expect(markToSeeds(['***', '', 'x'.repeat(64)], 'acme.com')).toEqual(['acme']);
    expect(markToSeeds(['Acme'], 'not a domain')).toEqual(['acme']);
  });
  it('preserves mark order across several marks', () => {
    expect(markToSeeds(['Beta', 'Alpha Co'], 'acme.com')).toEqual(['acme', 'beta', 'alphaco', 'alpha-co']);
  });
});
