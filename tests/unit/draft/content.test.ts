// Content guards over every built-in template. These encode the legal content
// rules: banner first, no unbracketed legal conclusions, a neutral compliance
// note, the DMCA statutory elements, and no hard-coded registration numbers.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTEXT_FIELDS } from '../../../src/core/draft/context';
import { BANNER } from '../../../src/core/draft/merge';
import { parseTemplate } from '../../../src/core/draft/template';
import { BUILTIN_TEMPLATE_IDS } from '../../../src/core/types';

const DIR = new URL('../../../templates/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
const sources = Object.fromEntries(files.map((f) => [f.replace(/\.md$/, ''), readFileSync(new URL(f, DIR), 'utf8')]));

const PLACEHOLDER_PREFIX = '[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: ';

const DENYLIST = ['constitutes infringement', 'infringes', 'is infringing', 'in bad faith', 'bad faith registration', 'is liable', 'you are liable', 'willful', 'violates', 'unlawful', 'illegal'];
const COMPLIANCE_FORBIDDEN = ['infringe', 'demand', 'cease', 'liable', 'violation', 'legal action', 'lawsuit', 'damages'];

const DMCA_ELEMENTS = [
  '(i) A physical or electronic signature of a person authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.',
  '(ii) Identification of the copyrighted work claimed to have been infringed, or, if multiple copyrighted works at a single online site are covered by a single notification, a representative list of such works at that site.',
  '(iii) Identification of the material that is claimed to be infringing or to be the subject of infringing activity and that is to be removed or access to which is to be disabled, and information reasonably sufficient to permit the service provider to locate the material.',
  '(iv) Information reasonably sufficient to permit the service provider to contact the complaining party, such as an address, telephone number, and, if available, an electronic mail address at which the complaining party may be contacted.',
  '(v) A statement that the complaining party has a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.',
  '(vi) A statement that the information in the notification is accurate, and under penalty of perjury, that the complaining party is authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.',
];

/** Removes every "[PLACEHOLDER …]" span, matching nested brackets. Throws on an unclosed placeholder. */
function stripPlaceholders(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('[PLACEHOLDER', i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    let depth = 0;
    let j = start;
    for (; j < text.length; j++) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']' && --depth === 0) break;
    }
    if (j >= text.length) throw new Error(`unclosed placeholder at offset ${start}`);
    out += ' ';
    i = j + 1;
  }
  return out;
}

function bodyOf(src: string): string {
  return src.replace(/\r\n/g, '\n').split('\n---\n').slice(1).join('\n---\n');
}

describe('guard helpers (self-test, so the guards cannot pass vacuously)', () => {
  it('stripPlaceholders removes nested placeholder spans and keeps the rest', () => {
    expect(stripPlaceholders(`a ${PLACEHOLDER_PREFIX}x [counsel: y] z] b`)).toBe('a   b');
    expect(() => stripPlaceholders('[PLACEHOLDER open')).toThrow(/unclosed/);
  });
  it('a denylisted phrase outside a placeholder is detected', () => {
    const outside = stripPlaceholders(`The registrant acted in bad faith. ${PLACEHOLDER_PREFIX}is liable]`).toLowerCase();
    expect(DENYLIST.filter((p) => outside.includes(p))).toEqual(['in bad faith']);
  });
});

describe('built-in template files', () => {
  it('there is exactly one file per built-in id, named after its id', () => {
    expect(Object.keys(sources).sort()).toEqual([...BUILTIN_TEMPLATE_IDS].sort());
    for (const [name, src] of Object.entries(sources)) {
      const r = parseTemplate(src, { builtin: true });
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.template.id).toBe(name);
      // Built-ins parse with zero errors AND zero warnings (no unknown paths, banner present, etc.).
      expect(r.warnings, name).toEqual([]);
    }
  });
});

describe.each(Object.entries(sources))('content guards: %s', (name, src) => {
  it('the banner is the first line of the body', () => {
    expect(bodyOf(src).split('\n')[0]).toBe(BANNER);
  });

  it('legal conclusion phrases appear only inside [PLACEHOLDER …] brackets', () => {
    const outside = stripPlaceholders(src).toLowerCase().replace(/\s+/g, ' ');
    for (const phrase of DENYLIST) expect(outside, `"${phrase}" outside a placeholder in ${name}`).not.toContain(phrase);
  });

  it('every placeholder uses the standard marker and closes', () => {
    const count = src.split('[PLACEHOLDER').length - 1;
    expect(count, name).toBeGreaterThan(0);
    expect(src.split(PLACEHOLDER_PREFIX).length - 1, `non-standard placeholder marker in ${name}`).toBe(count);
    expect(() => stripPlaceholders(src)).not.toThrow();
  });

  it('contains no 4+ digit numbers outside merge fields that could be registration numbers', () => {
    const noFields = src.replace(/\{\{[^\n]*?\}\}/g, ' ');
    const allowed = (m: RegExpExecArray): boolean => {
      const before = noFields.slice(Math.max(0, m.index - 6), m.index);
      const after = noFields.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if (/§ ?$/.test(before)) return true; // statute section, e.g. 15 U.S.C. § 1125(d)
      if (/F\.3d $/.test(before)) return true; // reporter page, e.g. 815 F.3d 1145
      if (/^(19|20)\d\d$/.test(m[0])) return true; // a year in a case citation
      if (m[0] === '2,000' && after.startsWith(' characters')) return true; // RDRS description limit
      return false;
    };
    const re = /\d{1,3}(?:,\d{3})+|\d{4,}/g;
    const offenders: string[] = [];
    for (let m = re.exec(noFields); m; m = re.exec(noFields)) if (!allowed(m)) offenders.push(m[0]);
    expect(offenders, name).toEqual([]);
  });

  it('is plain text (no HTML tags)', () => {
    expect(src).not.toMatch(/<\/?[a-z][a-z0-9]*[\s>]/i);
  });
});

describe('template-specific guards', () => {
  it('compliance-note contains none of its forbidden words anywhere', () => {
    const text = (sources['compliance-note'] ?? '').toLowerCase();
    for (const w of COMPLIANCE_FORBIDDEN) expect(text, w).not.toContain(w);
  });

  it('dmca-notice contains all six statutory element labels of 17 U.S.C. § 512(c)(3)(A), each as its own line', () => {
    const lines = (sources['dmca-notice'] ?? '').split('\n');
    for (const label of DMCA_ELEMENTS) expect(lines, label.slice(0, 12)).toContain(label);
  });

  it('dmca-notice requires the element inputs and carries the internal copyright/§ 512(f)/Lenz note', () => {
    const r = parseTemplate(sources['dmca-notice'] ?? '');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const required = new Set(r.template.fields.filter((f) => !f.optional).map((f) => f.path));
    for (const p of ['input.signature', 'input.copyrightedWork', 'input.infringingMaterial', 'input.infringingLocation', 'sender.name', 'sender.address', 'sender.phone', 'sender.email']) {
      expect(required, p).toContain(p);
    }
    const src = sources['dmca-notice'] ?? '';
    expect(src).toMatch(/\[INTERNAL NOTE — DELETE BEFORE SENDING: The DMCA covers copyright, not trademark\./);
    expect(src).toContain('17 U.S.C. § 512(f)');
    expect(src).toContain('Lenz v. Universal Music Corp., 815 F.3d 1145 (9th Cir. 2016)');
  });

  it('registrar-abuse references the RAA only inside a placeholder', () => {
    const src = sources['registrar-abuse'] ?? '';
    expect(src).toContain('Registrar Accreditation Agreement');
    expect(stripPlaceholders(src)).not.toContain('Registrar Accreditation Agreement');
    expect(src).toContain('{{sources}}');
  });

  it('demand-letter mentions escalation paths only inside a placeholder', () => {
    const src = sources['demand-letter'] ?? '';
    expect(src).toMatch(/UDRP \/ ACPA 15 U\.S\.C\. § 1125\(d\)/);
    const outside = stripPlaceholders(src);
    expect(outside).not.toMatch(/ACPA|1125|UDRP proceeding|lawsuit|court/i);
    expect(src).toContain('{{input.requestedActions | lines');
    expect(src).toContain('{{input.responseDeadline');
    expect(src).toContain('{{mark.rights | lines');
  });

  it('disclosure-request has the RDRS copy sheet and the §10.2 fields with follow-up dates', () => {
    const src = sources['disclosure-request'] ?? '';
    expect(src).toContain('A. ICANN RDRS COPY SHEET');
    expect(src).toContain('B. DIRECT REQUEST TO THE REGISTRAR UNDER THE ICANN REGISTRATION DATA POLICY §10');
    expect(src).toContain('https://rdrs.icann.org');
    expect(src).toContain('Request category: IP holder');
    expect(src).toMatch(/maximum 2,000 characters/);
    expect(src).toMatch(/PDF only, at most 5 files, each at most 5 MB/);
    expect(src).toMatch(/does not cover ccTLDs/);
    for (const p of ['input.requestorEntityType', 'input.dataElements', 'input.disclosureRationale', 'input.goodFaithAffirmation', 'input.lawfulProcessingAgreement', 'input.legalBasis', 'followUp.ack', 'followUp.response']) {
      expect(src, p).toContain(`{{${p}`);
    }
  });

  it('udrp-annex is organized by the three ¶4(a) elements and notes URS eligibility', () => {
    const src = sources['udrp-annex'] ?? '';
    expect(src).toContain('ELEMENT 1 — UDRP ¶4(a)(i)');
    expect(src).toContain('ELEMENT 2 — UDRP ¶4(a)(ii)');
    expect(src).toContain('ELEMENT 3 — UDRP ¶4(a)(iii)');
    expect(src).toContain('{{urs.eligible}}');
    expect(src).toContain('{{evidence.list | lines');
  });
});

describe('templates/README.md', () => {
  const readme = readFileSync(new URL('README.md', DIR), 'utf8');
  it('documents every context path', () => {
    for (const f of CONTEXT_FIELDS) expect(readme, f.path).toContain(`\`${f.path}\``);
  });
  it('documents the banner and the modifiers', () => {
    expect(readme).toContain(BANNER);
    for (const m of ['| optional', '| hint:', '| lines', '{{sources}}']) expect(readme).toContain(m);
  });
});
