// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: ported to TypeScript; tables (Fuzzer.glyphs_idn_by_tld, glyphs_unicode, glyphs_ascii,
// latin_to_cyrillic) copied verbatim with tuples as arrays, TLDs that share a repertoire grouped by name,
// and a suffix lookup that falls back to the last label (so "org.uk" uses the "uk" entry).

/** Lookalike table: a source string (one or two characters) → replacements. */
export type GlyphTable = Readonly<Record<string, readonly string[]>>;

// Registries that accept no IDNs (or none we can generate safely): ASCII lookalikes only.
const NO_IDN: GlyphTable = {};

const INFO: GlyphTable = {
  a: ['á', 'ä', 'å', 'ą'],
  c: ['ć', 'č'],
  e: ['é', 'ė', 'ę'],
  i: ['í', 'į'],
  l: ['ł'],
  n: ['ñ', 'ń'],
  o: ['ó', 'ö', 'ø', 'ő'],
  s: ['ś', 'š'],
  u: ['ú', 'ü', 'ū', 'ű', 'ų'],
  z: ['ź', 'ż', 'ž'],
  ae: ['æ'],
};

const BR: GlyphTable = {
  a: ['à', 'á', 'â', 'ã'],
  c: ['ç'],
  e: ['é', 'ê'],
  i: ['í'],
  o: ['ó', 'ô', 'õ'],
  u: ['ú', 'ü'],
  y: ['ý', 'ÿ'],
};

const DK: GlyphTable = {
  a: ['ä', 'å'],
  e: ['é'],
  o: ['ö', 'ø'],
  u: ['ü'],
  ae: ['æ'],
};

const EU_DE_PL: GlyphTable = {
  a: ['á', 'à', 'ă', 'â', 'å', 'ä', 'ã', 'ą', 'ā'],
  c: ['ć', 'ĉ', 'č', 'ċ', 'ç'],
  d: ['ď', 'đ'],
  e: ['é', 'è', 'ĕ', 'ê', 'ě', 'ë', 'ė', 'ę', 'ē'],
  g: ['ğ', 'ĝ', 'ġ', 'ģ'],
  h: ['ĥ', 'ħ'],
  i: ['í', 'ì', 'ĭ', 'î', 'ï', 'ĩ', 'į', 'ī'],
  j: ['ĵ'],
  k: ['ķ', 'ĸ'],
  l: ['ĺ', 'ľ', 'ļ', 'ł'],
  n: ['ń', 'ň', 'ñ', 'ņ'],
  o: ['ó', 'ò', 'ŏ', 'ô', 'ö', 'ő', 'õ', 'ø', 'ō'],
  r: ['ŕ', 'ř', 'ŗ'],
  s: ['ś', 'ŝ', 'š', 'ş'],
  t: ['ť', 'ţ', 'ŧ'],
  u: ['ú', 'ù', 'ŭ', 'û', 'ů', 'ü', 'ű', 'ũ', 'ų', 'ū'],
  w: ['ŵ'],
  y: ['ý', 'ŷ', 'ÿ'],
  z: ['ź', 'ž', 'ż'],
  ae: ['æ'],
  oe: ['œ'],
};

const FI: GlyphTable = {
  '3': ['ʒ'],
  a: ['á', 'ä', 'å', 'â'],
  c: ['č'],
  d: ['đ'],
  g: ['ǧ', 'ǥ'],
  k: ['ǩ'],
  n: ['ŋ'],
  o: ['õ', 'ö'],
  s: ['š'],
  t: ['ŧ'],
  z: ['ž'],
};

const NO: GlyphTable = {
  a: ['á', 'à', 'ä', 'å'],
  c: ['č', 'ç'],
  e: ['é', 'è', 'ê'],
  i: ['ï'],
  n: ['ŋ', 'ń', 'ñ'],
  o: ['ó', 'ò', 'ô', 'ö', 'ø'],
  s: ['š'],
  t: ['ŧ'],
  u: ['ü'],
  z: ['ž'],
  ae: ['æ'],
};

const FR: GlyphTable = {
  a: ['à', 'á', 'â', 'ã', 'ä', 'å'],
  c: ['ç'],
  e: ['è', 'é', 'ê', 'ë'],
  i: ['ì', 'í', 'î', 'ï'],
  n: ['ñ'],
  o: ['ò', 'ó', 'ô', 'õ', 'ö'],
  u: ['ù', 'ú', 'û', 'ü'],
  y: ['ý', 'ÿ'],
  ae: ['æ'],
  oe: ['œ'],
};

const CA: GlyphTable = {
  a: ['à', 'â'],
  c: ['ç'],
  e: ['è', 'é', 'ê', 'ë'],
  i: ['î', 'ï'],
  o: ['ô'],
  u: ['ù', 'û', 'ü'],
  y: ['ÿ'],
  ae: ['æ'],
  oe: ['œ'],
};

const byTld = (tlds: string[], table: GlyphTable) => Object.fromEntries(tlds.map((t) => [t, table]));

/** Per-registry IDN repertoire. Suffixes not listed here get GLYPHS_UNICODE. */
export const GLYPHS_IDN_BY_TLD: Readonly<Record<string, GlyphTable>> = {
  ...byTld(['ad', 'cz', 'sk', 'uk', 'co.uk', 'nl', 'edu', 'us'], NO_IDN),
  ...byTld(['jp', 'co.jp', 'ad.jp', 'ne.jp'], NO_IDN),
  ...byTld(['cn', 'com.cn', 'tw', 'com.tw', 'net.tw'], NO_IDN),
  ...byTld(['info'], INFO),
  ...byTld(['br', 'com.br'], BR),
  ...byTld(['dk'], DK),
  ...byTld(['eu', 'de', 'pl'], EU_DE_PL),
  ...byTld(['fi'], FI),
  ...byTld(['no'], NO),
  ...byTld(['be', 'fr', 're', 'yt', 'pm', 'wf', 'tf', 'ch', 'li'], FR),
  ...byTld(['ca'], CA),
};

export const GLYPHS_UNICODE: GlyphTable = {
  '2': ['ƻ'],
  '3': ['ʒ'],
  '5': ['ƽ'],
  a: ['ạ', 'ă', 'ȧ', 'ɑ', 'å', 'ą', 'â', 'ǎ', 'á', 'ə', 'ä', 'ã', 'ā', 'à'],
  b: ['ḃ', 'ḅ', 'ƅ', 'ʙ', 'ḇ', 'ɓ'],
  c: ['č', 'ᴄ', 'ċ', 'ç', 'ć', 'ĉ', 'ƈ'],
  d: ['ď', 'ḍ', 'ḋ', 'ɖ', 'ḏ', 'ɗ', 'ḓ', 'ḑ', 'đ'],
  e: ['ê', 'ẹ', 'ę', 'è', 'ḛ', 'ě', 'ɇ', 'ė', 'ĕ', 'é', 'ë', 'ē', 'ȩ'],
  f: ['ḟ', 'ƒ'],
  g: ['ǧ', 'ġ', 'ǵ', 'ğ', 'ɡ', 'ǥ', 'ĝ', 'ģ', 'ɢ'],
  h: ['ȟ', 'ḫ', 'ḩ', 'ḣ', 'ɦ', 'ḥ', 'ḧ', 'ħ', 'ẖ', 'ⱨ', 'ĥ'],
  i: ['ɩ', 'ǐ', 'í', 'ɪ', 'ỉ', 'ȋ', 'ɨ', 'ï', 'ī', 'ĩ', 'ị', 'î', 'ı', 'ĭ', 'į', 'ì'],
  j: ['ǰ', 'ĵ', 'ʝ', 'ɉ'],
  k: ['ĸ', 'ǩ', 'ⱪ', 'ḵ', 'ķ', 'ᴋ', 'ḳ'],
  l: ['ĺ', 'ł', 'ɫ', 'ļ', 'ľ'],
  m: ['ᴍ', 'ṁ', 'ḿ', 'ṃ', 'ɱ'],
  n: ['ņ', 'ǹ', 'ń', 'ň', 'ṅ', 'ṉ', 'ṇ', 'ꞑ', 'ñ', 'ŋ'],
  o: ['ö', 'ó', 'ȯ', 'ỏ', 'ô', 'ᴏ', 'ō', 'ò', 'ŏ', 'ơ', 'ő', 'õ', 'ọ', 'ø'],
  p: ['ṗ', 'ƿ', 'ƥ', 'ṕ'],
  q: ['ʠ'],
  r: ['ʀ', 'ȓ', 'ɍ', 'ɾ', 'ř', 'ṛ', 'ɽ', 'ȑ', 'ṙ', 'ŗ', 'ŕ', 'ɼ', 'ṟ'],
  s: ['ṡ', 'ș', 'ŝ', 'ꜱ', 'ʂ', 'š', 'ś', 'ṣ', 'ş'],
  t: ['ť', 'ƫ', 'ţ', 'ṭ', 'ṫ', 'ț', 'ŧ'],
  u: ['ᴜ', 'ų', 'ŭ', 'ū', 'ű', 'ǔ', 'ȕ', 'ư', 'ù', 'ů', 'ʉ', 'ú', 'ȗ', 'ü', 'û', 'ũ', 'ụ'],
  v: ['ᶌ', 'ṿ', 'ᴠ', 'ⱴ', 'ⱱ', 'ṽ'],
  w: ['ᴡ', 'ẇ', 'ẅ', 'ẃ', 'ẘ', 'ẉ', 'ⱳ', 'ŵ', 'ẁ'],
  x: ['ẋ', 'ẍ'],
  y: ['ŷ', 'ÿ', 'ʏ', 'ẏ', 'ɏ', 'ƴ', 'ȳ', 'ý', 'ỿ', 'ỵ'],
  z: ['ž', 'ƶ', 'ẓ', 'ẕ', 'ⱬ', 'ᴢ', 'ż', 'ź', 'ʐ'],
  ae: ['æ'],
  oe: ['œ'],
};

/** ASCII lookalikes, always applied regardless of the TLD's IDN policy. */
export const GLYPHS_ASCII: GlyphTable = {
  '0': ['o'],
  '1': ['l', 'i'],
  '3': ['8'],
  '6': ['9'],
  '8': ['3'],
  '9': ['6'],
  b: ['d', 'lb'],
  c: ['e'],
  d: ['b', 'cl', 'dl'],
  e: ['c'],
  g: ['q'],
  h: ['lh'],
  i: ['1', 'l'],
  k: ['lc'],
  l: ['1', 'i'],
  m: ['n', 'nn', 'rn'],
  n: ['m', 'r'],
  o: ['0'],
  q: ['g'],
  u: ['v'],
  v: ['u'],
  w: ['vv'],
  rn: ['m'],
  cl: ['d'],
};

/** Whole-label Latin → Cyrillic substitution. Letters without a Cyrillic twin are absent. */
export const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: 'а', b: 'ь', c: 'с', d: 'ԁ', e: 'е', g: 'ԍ', h: 'һ', i: 'і', j: 'ј', k: 'к', l: 'ӏ',
  m: 'м', o: 'о', p: 'р', q: 'ԛ', s: 'ѕ', t: 'т', v: 'ѵ', w: 'ԝ', x: 'х', y: 'у',
};

/**
 * The IDN repertoire entry for an ASCII public suffix, or undefined when the
 * registry is not in GLYPHS_IDN_BY_TLD. Falls back from the full suffix to its
 * last label, because second-level registrations under a ccTLD follow the
 * ccTLD's policy.
 */
export function idnRepertoire(suffix: string): GlyphTable | undefined {
  return GLYPHS_IDN_BY_TLD[suffix] ?? GLYPHS_IDN_BY_TLD[suffix.slice(suffix.lastIndexOf('.') + 1)];
}

const merged = new Map<GlyphTable, GlyphTable>();

/**
 * ASCII lookalikes merged with the suffix's Unicode repertoire (dnstwist's
 * `md(glyphs_ascii, glyphs_idn_by_tld.get(tld, glyphs_unicode))`). Values keep
 * a fixed order, ASCII first, so output is deterministic.
 */
export function glyphsForSuffix(suffix: string): GlyphTable {
  const unicode = idnRepertoire(suffix) ?? GLYPHS_UNICODE;
  let table = merged.get(unicode);
  if (!table) {
    const out: Record<string, string[]> = {};
    for (const src of [GLYPHS_ASCII, unicode]) {
      for (const [k, vs] of Object.entries(src)) {
        const list = (out[k] ??= []);
        for (const v of vs) if (!list.includes(v)) list.push(v);
      }
    }
    table = out;
    merged.set(unicode, table);
  }
  return table;
}
