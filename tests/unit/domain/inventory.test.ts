import { describe, expect, it } from 'vitest';
import { matchInventory, parseDomainList } from '../../../src/core/domain';
import type { InventoryEntry } from '../../../src/core/types';

describe('parseDomainList', () => {
  it('splits on newlines, commas, semicolons and whitespace, normalizing each entry', () => {
    expect(parseDomainList('acme.com, Acme.org;https://x.acme.net/a\n\tACME.io  acme.co.uk')).toEqual({
      valid: ['acme.com', 'acme.org', 'x.acme.net', 'acme.io', 'acme.co.uk'],
      invalid: [],
    });
  });
  it('keeps wildcards, normalizing their base', () => {
    expect(parseDomainList('*.Acme.COM\n*.exämple.com').valid).toEqual(['*.acme.com', '*.xn--exmple-cua.com']);
  });
  it('dedupes in first-seen order, including entries that normalize alike', () => {
    expect(parseDomainList('b.com a.com B.com. https://a.com/').valid).toEqual(['b.com', 'a.com']);
  });
  it('returns invalid tokens verbatim, once', () => {
    expect(parseDomainList('acme.com bad_domain *.com localhost bad_domain *')).toEqual({
      valid: ['acme.com'],
      invalid: ['bad_domain', '*.com', 'localhost', '*'],
    });
  });
  it('handles empty input', () => {
    expect(parseDomainList(' \n ,; ')).toEqual({ valid: [], invalid: [] });
  });
});

describe('matchInventory', () => {
  const owned: InventoryEntry = { pattern: 'acme.com', kind: 'owned' };
  const partner: InventoryEntry = { pattern: '*.partner.net', kind: 'authorized', party: 'Partner Ltd' };
  const shop: InventoryEntry = { pattern: 'WWW.Shop.Example.org', kind: 'owned' };
  const inv = [owned, partner, shop];

  it('matches anything under a registrable-domain entry', () => {
    expect(matchInventory('acme.com', inv)).toBe(owned);
    expect(matchInventory('login.acme.com', inv)).toBe(owned);
    expect(matchInventory('acme.co', inv)).toBeNull();
    expect(matchInventory('notacme.com', inv)).toBeNull();
  });
  it('matches the base and every subdomain of a wildcard entry', () => {
    expect(matchInventory('partner.net', inv)).toBe(partner);
    expect(matchInventory('a.b.partner.net', inv)).toBe(partner);
    expect(matchInventory('xpartner.net', inv)).toBeNull();
  });
  it('treats a deeper host entry as that host and its subdomains only', () => {
    expect(matchInventory('www.shop.example.org', inv)).toBe(shop);
    expect(matchInventory('a.www.shop.example.org', inv)).toBe(shop);
    expect(matchInventory('example.org', inv)).toBeNull();
    expect(matchInventory('other.example.org', inv)).toBeNull();
  });
  it('never widens an entry under a private suffix to the whole suffix', () => {
    const gh: InventoryEntry = { pattern: 'acme.github.io', kind: 'owned' };
    expect(matchInventory('acme.github.io', [gh])).toBe(gh);
    expect(matchInventory('evil.github.io', [gh])).toBeNull();
  });
  it('lets owned win over authorized regardless of order', () => {
    const auth: InventoryEntry = { pattern: 'acme.com', kind: 'authorized', party: 'Agency' };
    const own: InventoryEntry = { pattern: '*.acme.com', kind: 'owned' };
    expect(matchInventory('a.acme.com', [auth, own])).toBe(own);
    expect(matchInventory('a.acme.com', [own, auth])).toBe(own);
  });
  it('returns the first authorized entry when no owned entry matches', () => {
    const a1: InventoryEntry = { pattern: 'acme.com', kind: 'authorized', party: 'One' };
    const a2: InventoryEntry = { pattern: '*.acme.com', kind: 'authorized', party: 'Two' };
    expect(matchInventory('acme.com', [a1, a2])).toBe(a1);
  });
  it('normalizes unnormalized patterns and domains', () => {
    const e1: InventoryEntry = { pattern: 'https://ACME.com/', kind: 'owned' };
    const e2: InventoryEntry = { pattern: ' Exämple.com ', kind: 'authorized' };
    const e3: InventoryEntry = { pattern: '*.Café.FR', kind: 'owned' };
    expect(matchInventory('acme.com', [e1])).toBe(e1);
    expect(matchInventory('xn--exmple-cua.com', [e2])).toBe(e2);
    expect(matchInventory('shop.xn--caf-dma.fr', [e3])).toBe(e3);
    expect(matchInventory('LOGIN.Acme.com.', [owned])).toBe(owned);
  });
  it('ignores entries that match nothing sensible', () => {
    const bad: InventoryEntry[] = [
      { pattern: 'com', kind: 'owned' },
      { pattern: 'co.uk', kind: 'owned' },
      { pattern: 'not a domain', kind: 'owned' },
      { pattern: '*.com', kind: 'owned' },
    ];
    expect(matchInventory('acme.com', bad)).toBeNull();
    expect(matchInventory('acme.co.uk', bad)).toBeNull();
  });
  it('returns null for an invalid domain or empty inventory', () => {
    expect(matchInventory('not a domain', inv)).toBeNull();
    expect(matchInventory('acme.com', [])).toBeNull();
  });
});
