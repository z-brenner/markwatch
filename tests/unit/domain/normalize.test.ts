import { describe, expect, it } from 'vitest';
import { encodeDomain, isValidAsciiLabel, normalizeDomain } from '../../../src/core/domain';

const ascii = (s: string) => normalizeDomain(s)?.ascii ?? null;

describe('normalizeDomain', () => {
  it('strips scheme, path, query, case and encodes IDN labels', () => {
    expect(normalizeDomain('https://WWW.Exämple.com/path?x')).toEqual({ ascii: 'www.xn--exmple-cua.com', unicode: 'www.exämple.com' });
  });
  it('trims whitespace and the trailing dot', () => {
    expect(normalizeDomain(' example.com. ')).toEqual({ ascii: 'example.com', unicode: 'example.com' });
  });
  it('accepts punycode input and decodes it for display', () => {
    expect(normalizeDomain('xn--exmple-cua.com')).toEqual({ ascii: 'xn--exmple-cua.com', unicode: 'exämple.com' });
    expect(normalizeDomain('XN--EXMPLE-CUA.COM')?.unicode).toBe('exämple.com');
  });
  it('strips credentials, port and fragment', () => {
    expect(ascii('ftp://user:pw@Acme.COM:8080/x#frag')).toBe('acme.com');
    expect(ascii('acme.com:443')).toBe('acme.com');
    expect(ascii('//acme.com/path')).toBe('acme.com');
    expect(ascii('acme.com#top')).toBe('acme.com');
  });
  it('keeps "www." because it is a distinct hostname', () => {
    expect(ascii('www.acme.com')).toBe('www.acme.com');
  });
  it('NFC-normalizes and lowercases Unicode', () => {
    expect(ascii('ÄBC.de')).toBe(ascii('äbc.de'));
    expect(ascii('cafe\u0301.fr')).toBe('xn--caf-dma.fr'); // decomposed é
  });
  it('maps ideographic full stops to dots', () => {
    expect(ascii('café。fr')).toBe('xn--caf-dma.fr');
  });
  it('rejects IP addresses and single labels', () => {
    expect(normalizeDomain('1.2.3.4')).toBeNull();
    expect(normalizeDomain('http://1.2.3.4/')).toBeNull();
    expect(normalizeDomain('[::1]')).toBeNull();
    expect(normalizeDomain('2001:db8::1')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('example.123')).toBeNull();
  });
  it('rejects empty labels and bad hyphens', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('a..com')).toBeNull();
    expect(normalizeDomain('.acme.com')).toBeNull();
    expect(normalizeDomain('-acme.com')).toBeNull();
    expect(normalizeDomain('acme-.com')).toBeNull();
    expect(normalizeDomain('ab--cd.com')).toBeNull(); // reserved positions 3–4
    expect(ascii('a--b.com')).toBe('a--b.com');
  });
  it('enforces label and total length', () => {
    expect(ascii(`${'a'.repeat(63)}.com`)).toBe(`${'a'.repeat(63)}.com`);
    expect(normalizeDomain(`${'a'.repeat(64)}.com`)).toBeNull();
    const label = 'a'.repeat(63);
    expect(ascii(`${label}.${label}.${label}.${'a'.repeat(57)}.com`)).not.toBeNull(); // 253
    expect(normalizeDomain(`${label}.${label}.${label}.${'a'.repeat(58)}.com`)).toBeNull(); // 254
    expect(normalizeDomain(`${'é'.repeat(60)}.com`)).toBeNull(); // encodes past 63
  });
  it('rejects illegal characters', () => {
    expect(normalizeDomain('exa mple.com')).toBeNull();
    expect(normalizeDomain('acme_corp.com')).toBeNull();
    expect(normalizeDomain('acme!.com')).toBeNull();
    expect(normalizeDomain('i❤.ws')).toBeNull(); // symbol, not a letter
    expect(normalizeDomain('ｅxample.com')).toBeNull(); // fullwidth compatibility form
  });
  it('rejects malformed A-labels', () => {
    expect(normalizeDomain('xn--abc.com')).toBeNull();
    expect(normalizeDomain('xn--acme-.com')).toBeNull();
    expect(normalizeDomain('xn--acme.com')).toBeNull(); // decodes to ASCII
  });
});

describe('isValidAsciiLabel', () => {
  it('accepts LDH labels and real A-labels only', () => {
    expect(isValidAsciiLabel('acme')).toBe(true);
    expect(isValidAsciiLabel('a')).toBe(true);
    expect(isValidAsciiLabel('xn--caf-dma')).toBe(true);
    expect(isValidAsciiLabel('')).toBe(false);
    expect(isValidAsciiLabel('Acme')).toBe(false);
    expect(isValidAsciiLabel('ab--c')).toBe(false);
  });
});

describe('encodeDomain', () => {
  it('encodes clean Unicode hostnames and validates them', () => {
    expect(encodeDomain('café.com')).toBe('xn--caf-dma.com');
    expect(encodeDomain('acme.co.uk')).toBe('acme.co.uk');
    expect(encodeDomain('-acme.com')).toBeNull();
    expect(encodeDomain('acme')).toBeNull();
    expect(encodeDomain('ÄCME.com')).toBeNull(); // input must already be lowercase
  });
});
