import { describe, expect, it } from 'vitest';
import { homoglyph } from '../../../src/core/permute/techniques/homoglyph';
import { GLYPHS_ASCII, GLYPHS_IDN_BY_TLD, GLYPHS_UNICODE } from '../../../src/core/permute/glyphs';
import { isValidUnicodeLabel } from '../../../src/core/domain';

const ctx = (suffix: string) => ({ suffix, keyboards: [], tlds: [], dictionary: [] });
const isAscii = (s: string) => /^\p{ASCII}*$/u.test(s);

describe('homoglyph', () => {
  it('applies single and multi-char glyphs over two rounds (ASCII-only TLD)', () => {
    // Round 1 on "cl": c→e, l→1/i, window "cl"→d. Round 2 adds e1, ei (from "el"), b, dl (from "d"); "cl" itself is excluded.
    expect(homoglyph('cl', ctx('co.uk'))).toEqual(['el', 'c1', 'ci', 'd', 'e1', 'ei', 'b', 'dl']);
  });
  it('maps "rn" to "m" and "m" to "rn"', () => {
    expect(homoglyph('arn', ctx('uk'))).toContain('am');
    expect(homoglyph('am', ctx('uk'))).toContain('arn');
  });
  it('handles a 1-char label without returning the label itself', () => {
    expect(homoglyph('o', ctx('us'))).toEqual(['0']);
  });
  it('uses only ASCII lookalikes for registries without IDN, including second-level suffixes', () => {
    for (const suffix of ['uk', 'co.uk', 'org.uk', 'us', 'jp', 'or.jp', 'cn']) {
      const out = homoglyph('acme', ctx(suffix));
      expect(out.length).toBeGreaterThan(0);
      expect(out.every(isAscii)).toBe(true);
    }
  });
  it('limits Unicode glyphs to the registry repertoire', () => {
    const de = homoglyph('acme', ctx('de'));
    expect(de).toContain('ácme');
    expect(de).not.toContain('ɑcme'); // Latin alpha is in the generic table only
    const allowed = new Set([...Object.values(GLYPHS_IDN_BY_TLD['de'] ?? {}).flat(), ...Object.values(GLYPHS_ASCII).flat()].join(''));
    for (const v of de) for (const ch of v) if (!isAscii(ch)) expect(allowed.has(ch)).toBe(true);
  });
  it('uses the full Unicode table for unlisted suffixes such as com', () => {
    const com = homoglyph('acme', ctx('com'));
    expect(com).toContain('ɑcme');
    expect(com).toContain('acrne'); // m → rn
    expect(com).not.toContain('acme');
  });
  it('emits only IDNA-encodable labels', () => {
    for (const suffix of ['com', 'de', 'info', 'fr']) {
      for (const v of homoglyph('café', ctx(suffix))) expect(isValidUnicodeLabel(v) || /^[a-z0-9-]+$/.test(v)).toBe(true);
    }
  });
  it('ships glyph tables whose Unicode values are all valid IDN characters', () => {
    const tables = [GLYPHS_UNICODE, ...Object.values(GLYPHS_IDN_BY_TLD)];
    for (const t of tables) for (const v of Object.values(t).flat()) expect(isValidUnicodeLabel(v)).toBe(true);
  });
  it('is deterministic', () => {
    expect(homoglyph('paypal', ctx('com'))).toEqual(homoglyph('paypal', ctx('com')));
  });
});
