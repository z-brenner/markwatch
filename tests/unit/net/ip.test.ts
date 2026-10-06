import { describe, expect, it } from 'vitest';
import { expandIPv6, ipv4FromMapped, ipv4InCidr, ipv6InCidr, ipv6Nibbles, isIPv4, isIPv6, parseCidr, reverseIPv4Labels } from '../../../src/core/net/ip';

describe('isIPv4', () => {
  it.each(['0.0.0.0', '8.8.8.8', '255.255.255.255', '193.0.6.139'])('accepts %s', (ip) => expect(isIPv4(ip)).toBe(true));
  it.each(['256.0.0.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-4', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', '', '1..2.3', '::1', '1.2.3.4/24'])('rejects %j', (ip) =>
    expect(isIPv4(ip)).toBe(false),
  );
  it('rejects non-strings without throwing', () => {
    expect(isIPv4(null as unknown as string)).toBe(false);
    expect(isIPv4(1234 as unknown as string)).toBe(false);
  });
});

describe('expandIPv6 / isIPv6', () => {
  it.each([
    ['::', '0000:0000:0000:0000:0000:0000:0000:0000'],
    ['::1', '0000:0000:0000:0000:0000:0000:0000:0001'],
    ['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001'],
    ['2606:4700:4700::1111', '2606:4700:4700:0000:0000:0000:0000:1111'],
    ['2001:DB8:0:0:8:800:200C:417A', '2001:0db8:0000:0000:0008:0800:200c:417a'],
    ['1:2:3:4:5:6:7::', '0001:0002:0003:0004:0005:0006:0007:0000'],
    ['::ffff:192.0.2.1', '0000:0000:0000:0000:0000:ffff:c000:0201'],
    ['64:ff9b::8.8.8.8', '0064:ff9b:0000:0000:0000:0000:0808:0808'],
  ])('%s → %s', (input, full) => {
    expect(expandIPv6(input)).toBe(full);
    expect(isIPv6(input)).toBe(true);
  });

  it.each(['', ':', ':::', '1::2::3', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8::', '12345::', 'g::1', 'fe80::1%eth0', '::ffff:300.1.1.1', '1.2.3.4', '1:2:3:4:5:6:7', ':1:2:3:4:5:6:7', 'x'.repeat(100)])(
    'rejects %j',
    (input) => {
      expect(expandIPv6(input)).toBeNull();
      expect(isIPv6(input)).toBe(false);
    },
  );
});

describe('parseCidr', () => {
  it('parses both families and rejects bad lengths', () => {
    expect(parseCidr('8.0.0.0/8')).toEqual({ version: 4, address: '8.0.0.0', prefix: 8 });
    expect(parseCidr('2001:4200::/23')).toEqual({ version: 6, address: '2001:4200::', prefix: 23 });
    for (const bad of ['8.0.0.0/33', '::/129', '8.0.0.0', '8.0.0.0/', '8.0.0.0/8/9', 'x/8', '8.0.0.0/-1', '8.0.0.0/08x']) expect(parseCidr(bad)).toBeNull();
  });
});

describe('ipv4InCidr', () => {
  it.each([
    ['8.8.8.8', '8.0.0.0/8', true],
    ['8.8.8.8', '8.8.8.0/24', true],
    ['8.8.9.1', '8.8.8.0/24', false],
    ['1.2.3.4', '0.0.0.0/0', true],
    ['1.2.3.4', '1.2.3.4/32', true],
    ['1.2.3.5', '1.2.3.4/32', false],
    ['255.255.255.255', '128.0.0.0/1', true],
    ['127.0.0.1', '128.0.0.0/1', false],
    ['8.8.8.8', '2001::/16', false],
    ['nope', '8.0.0.0/8', false],
    ['8.8.8.8', 'garbage', false],
  ])('%s in %s → %s', (ip, cidr, want) => expect(ipv4InCidr(ip, cidr)).toBe(want));
});

describe('ipv6InCidr', () => {
  it.each([
    ['2606:4700:4700::1111', '2600::/12', true],
    ['2606:4700:4700::1111', '2610::/12', false],
    ['2001:4860:4860::8888', '2001:4800::/23', true],
    ['2001:4c00::1', '2001:4800::/23', false],
    ['::1', '::/0', true],
    ['::1', '::1/128', true],
    ['::2', '::1/128', false],
    ['8.8.8.8', '::/0', false],
    ['2001::1', '8.0.0.0/8', false],
  ])('%s in %s → %s', (ip, cidr, want) => expect(ipv6InCidr(ip, cidr)).toBe(want));
});

describe('reverse names', () => {
  it('reverses IPv4 octets', () => {
    expect(reverseIPv4Labels('192.0.2.1')).toEqual(['1', '2', '0', '192']);
    expect(reverseIPv4Labels('2001::1')).toBeNull();
  });
  it('lists all 32 IPv6 nibbles in address order', () => {
    const n = ipv6Nibbles('2001:db8::1');
    expect(n).toHaveLength(32);
    expect(n?.join('')).toBe('20010db8000000000000000000000001');
    expect(ipv6Nibbles('1.2.3.4')).toBeNull();
  });
  it('extracts the IPv4 address from an IPv4-mapped IPv6 address only', () => {
    expect(ipv4FromMapped('::ffff:8.8.8.8')).toBe('8.8.8.8');
    expect(ipv4FromMapped('::ffff:0808:0808')).toBe('8.8.8.8');
    expect(ipv4FromMapped('64:ff9b::8.8.8.8')).toBeNull();
    expect(ipv4FromMapped('8.8.8.8')).toBeNull();
  });
});
