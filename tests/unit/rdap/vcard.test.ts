import { describe, expect, it } from 'vitest';
import { parseVcard, vcardProperties } from '../../../src/core/rdap/vcard';

const jcard = (...props: unknown[]): unknown => ['vcard', [['version', {}, 'text', '4.0'], ...props]];

describe('parseVcard', () => {
  it('reads fn, org, kind, email, tel, country and url', () => {
    const v = parseVcard(
      jcard(
        ['fn', {}, 'text', 'Domain Administrator'],
        ['org', { type: 'work' }, 'text', 'Google LLC'],
        ['kind', {}, 'text', 'Org'],
        ['email', {}, 'text', 'DNS-Admin@Google.com'],
        ['tel', { type: 'voice' }, 'uri', 'tel:+1.6502530000'],
        ['tel', { type: ['work', 'voice'] }, 'text', '+1-650-253-0000'],
        ['adr', { cc: 'us' }, 'text', ['', '', ['1600 Amphitheatre Parkway', '', ''], 'Mountain View', 'CA', '94043', '']],
        ['url', {}, 'uri', 'https://www.example.com/'],
      ),
    );
    expect(v).toEqual({
      fn: 'Domain Administrator',
      org: 'Google LLC',
      kind: 'org',
      emails: ['dns-admin@google.com'],
      tels: ['+1.6502530000', '+1-650-253-0000'],
      country: 'US',
      url: 'https://www.example.com/',
    });
  });

  it('drops the empty strings that registries use for absent values', () => {
    // Verisign's registrar abuse entity for example.com.
    const v = parseVcard(jcard(['fn', {}, 'text', ''], ['tel', { type: 'voice' }, 'uri', ''], ['email', {}, 'text', '']));
    expect(v).toEqual({ emails: [], tels: [] });
  });

  it('keeps a tel: extension and drops other URI parameters', () => {
    expect(parseVcard(jcard(['tel', {}, 'uri', 'tel:+1.5555551234;ext=42;phone-context=x'])).tels).toEqual(['+1.5555551234 ext. 42']);
  });

  it('falls back to the country-name component of adr', () => {
    expect(parseVcard(jcard(['adr', {}, 'text', ['', '', 'Street', 'City', '', '1000', 'Netherlands']])).country).toBe('Netherlands');
  });

  it('joins structured org values (org + unit)', () => {
    expect(parseVcard(jcard(['org', {}, 'text', ['Acme', 'Legal']])).org).toBe('Acme, Legal');
  });

  it('rejects non-http URLs and implausible emails', () => {
    const v = parseVcard(jcard(['url', {}, 'uri', 'javascript:alert(1)'], ['email', {}, 'text', 'not an email']));
    expect(v.url).toBeUndefined();
    expect(v.emails).toEqual([]);
  });

  it.each([null, undefined, 1, 'vcard', [], ['vcard'], ['vcard', 'x'], ['notvcard', [['fn', {}, 'text', 'x']]], { 0: 'vcard' }])('returns an empty summary for %j', (bad) => {
    expect(parseVcard(bad)).toEqual({ emails: [], tels: [] });
  });

  it('skips malformed properties and caps the count', () => {
    const props = vcardProperties(['vcard', [null, 'fn', ['fn'], ['fn', {}, 5, 'x'], [5, {}, 'text', 'x'], ['FN', null, 'text', 'Ok'], ...Array.from({ length: 5000 }, () => ['note', {}, 'text', 'x'])]]);
    expect(props[0]).toEqual({ name: 'fn', params: {}, valueType: 'text', values: ['Ok'] });
    expect(props.length).toBeLessThanOrEqual(300);
  });

  it('caps huge strings', () => {
    expect(parseVcard(jcard(['fn', {}, 'text', 'A'.repeat(1_000_000)])).fn?.length).toBe(1000);
  });
});
