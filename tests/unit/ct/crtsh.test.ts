import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CtEntry } from '../../../src/core/types';
import { crtshUrl, manualCrtshUrl, parseCrtsh, registrableNamesFromCt } from '../../../src/core/ct/crtsh';

const fx = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

/** Naive eTLD+1 for the tests (the app passes the tldts-based function). */
const lastTwo = (name: string): string | null => {
  const labels = name.split('.');
  if (labels.length < 2) return null;
  const n = ['co.uk', 'org.tr'].some((s) => name.endsWith(`.${s}`)) ? 3 : 2;
  return labels.length >= n ? labels.slice(-n).join('.') : null;
};

describe('crtshUrl / manualCrtshUrl', () => {
  it('builds a prefix search by default (the "%term%" form silently returns [])', () => {
    expect(crtshUrl('Acme')).toBe('https://crt.sh/?q=acme%25&output=json&exclude=expired');
    expect(manualCrtshUrl('Acme')).toBe('https://crt.sh/?q=acme%25&exclude=expired');
  });
  it('can still build the substring form on request', () => {
    expect(crtshUrl('acme', 'substring')).toBe('https://crt.sh/?q=%25acme%25&output=json&exclude=expired');
    expect(manualCrtshUrl('acme', 'substring')).toBe('https://crt.sh/?q=%25acme%25&exclude=expired');
  });
  it('percent-encodes the term', () => {
    const url = crtshUrl(' a&b=c#d ');
    expect(url).toBe('https://crt.sh/?q=a%26b%3Dc%23d%25&output=json&exclude=expired');
    expect(new URL(url).searchParams.get('output')).toBe('json');
    expect(crtshUrl('xn--caf-dma')).toContain('q=xn--caf-dma%25');
  });
});

describe('parseCrtsh on the real fixture', () => {
  const entries = parseCrtsh(fx('crtsh/dnsviz.json')) ?? [];

  it('parses every row (precertificate and certificate rows have distinct ids)', () => {
    expect(entries).toHaveLength(42);
    expect(new Set(entries.map((e) => e.id)).size).toBe(42);
  });

  it('maps fields and treats zone-less timestamps as UTC', () => {
    expect(entries[0]).toEqual({
      id: 29590843168,
      commonName: 'dnsviz.org',
      names: ['dnsviz.org'],
      issuer: 'C=US, O=GoDaddy.com, CN=GoDaddy TLS Intermediate CA DV - R1v1',
      notBefore: '2026-09-29T17:08:54.000Z',
      notAfter: '2027-04-15T17:08:54.000Z',
    });
  });

  it('splits newline-separated SANs and merges the common name', () => {
    const multi = entries.find((e) => e.names.length > 3);
    expect(multi?.names).toEqual(expect.arrayContaining(['dnsviz.net', 'dnsviz.dns-oarc.net', 'dnsviz-dev.dns-oarc.net']));
  });

  it('groups by registrable domain', () => {
    const map = registrableNamesFromCt(entries, lastTwo);
    expect([...map.keys()]).toEqual(expect.arrayContaining(['dnsviz.org', 'dnsviz.net', 'dns-oarc.net', 'billmann-edv.de', 'dnssec.org.tr', 'dnsviz.com']));
    // A certificate naming dnsviz.net and three dns-oarc.net hosts is listed once under each.
    const oarc = map.get('dns-oarc.net') ?? [];
    expect(new Set(oarc.map((e) => e.id)).size).toBe(oarc.length);
  });
});

describe('parseCrtsh on hostile input', () => {
  it.each([null, undefined, 1, 'x', {}, { error: 'rate limited' }])('returns null for non-array %j (never "no certificates")', (v) => expect(parseCrtsh(v)).toBeNull());

  it('returns [] for an empty array', () => {
    expect(parseCrtsh([])).toEqual([]);
  });

  it('skips rows without an id or dates, and accepts numeric-string ids', () => {
    const rows = [
      null,
      'row',
      { id: 'abc', not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00' },
      { id: 1, not_before: 'bad', not_after: '2026-04-01T00:00:00' },
      { id: -1, not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00' },
      { id: '7', common_name: 'A.Example.COM', not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00', entry_timestamp: '2026-01-01T00:05:00.123' },
    ];
    expect(parseCrtsh(rows)).toEqual([
      {
        id: 7,
        commonName: 'a.example.com',
        names: ['a.example.com'],
        issuer: '',
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2026-04-01T00:00:00.000Z',
        entryTimestamp: '2026-01-01T00:05:00.123Z',
      },
    ]);
  });

  it('merges duplicate ids and dedupes and lowercases names', () => {
    const row = { not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00', issuer_name: 'CA' };
    const out = parseCrtsh([
      { ...row, id: 5, common_name: 'x.com', name_value: 'X.com\nwww.x.com' },
      { ...row, id: 5, common_name: 'x.com', name_value: 'api.x.com\nwww.x.com' },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]?.names).toEqual(['x.com', 'www.x.com', 'api.x.com']);
  });

  it('keeps wildcard names but drops emails, IPs, spaces and junk identities', () => {
    const out = parseCrtsh([
      {
        id: 9,
        common_name: '*.Acme.com',
        name_value: '*.acme.com\nadmin@acme.com\n192.0.2.1\nsome name\n<script>\nlocalhost\nacme.com.\n*.*.acme.com',
        not_before: '2026-01-01T00:00:00',
        not_after: '2026-04-01T00:00:00',
      },
    ]);
    expect(out?.[0]?.names).toEqual(['*.acme.com', 'acme.com']);
  });

  it('caps huge rows and huge responses', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `h${i}.x.com`).join('\n');
    const out = parseCrtsh([{ id: 1, common_name: 'x.com', name_value: many, not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00' }]);
    expect(out?.[0]?.names.length).toBe(1000);
    const rows = Array.from({ length: 20_000 }, (_, i) => ({ id: i + 1, common_name: 'x.com', not_before: '2026-01-01T00:00:00', not_after: '2026-04-01T00:00:00' }));
    expect(parseCrtsh(rows)?.length).toBe(10_000);
  });
});

describe('registrableNamesFromCt', () => {
  const entry = (id: number, names: string[]): CtEntry => ({ id, commonName: names[0] ?? '', names, issuer: '', notBefore: '', notAfter: '' });

  it('strips "*." and skips names without a registrable domain', () => {
    const map = registrableNamesFromCt([entry(1, ['*.login.acme-secure.com', 'acme-secure.com', 'localhost.x'])], (n) => (n.startsWith('localhost') ? null : lastTwo(n)));
    expect([...map.entries()]).toEqual([['acme-secure.com', [entry(1, ['*.login.acme-secure.com', 'acme-secure.com', 'localhost.x'])]]]);
  });

  it('lists an entry once per registrable domain, in first-seen order', () => {
    const a = entry(1, ['a.x.com', 'b.x.com', 'y.net']);
    const b = entry(2, ['y.net']);
    const map = registrableNamesFromCt([a, b], lastTwo);
    expect([...map.keys()]).toEqual(['x.com', 'y.net']);
    expect(map.get('x.com')).toEqual([a]);
    expect(map.get('y.net')).toEqual([a, b]);
  });
});
