// IPv4/IPv6 parsing and CIDR arithmetic. Pure and strict: anything that is
// not a well-formed address returns false/null rather than throwing. Zone IDs
// ("fe80::1%eth0") are rejected; they mean nothing outside the local host.

const V4_OCTET = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Dotted-quad IPv4 with no leading zeros ("010.0.0.1" is rejected as ambiguous). */
export function isIPv4(s: string): boolean {
  if (typeof s !== 'string' || s.length > 15) return false;
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => V4_OCTET.test(p));
}

/** True for any valid IPv6 text form, including "::" compression and an IPv4 tail. */
export function isIPv6(s: string): boolean {
  return expandIPv6(s) !== null;
}

/**
 * Full, lowercase, 8-group form: "2001:db8::1" → "2001:0db8:0000:0000:0000:0000:0000:0001".
 * An embedded IPv4 tail ("::ffff:192.0.2.1") is converted to two hex groups.
 * Returns null for invalid input.
 */
export function expandIPv6(s: string): string | null {
  const groups = ipv6Groups(s);
  return groups ? groups.map((g) => g.toString(16).padStart(4, '0')).join(':') : null;
}

function ipv6Groups(input: string): number[] | null {
  if (typeof input !== 'string' || input.length < 2 || input.length > 45) return null;
  let s = input.toLowerCase();
  // IPv4 tail → two hex groups.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const o = tail.split('.').map(Number) as [number, number, number, number];
    s = `${s.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = parse(halves[1] ?? '');
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  // "::" must stand for at least one group.
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function ipv4ToInt(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const g = ipv6Groups(ip);
  if (!g) return null;
  return g.reduce((acc, x) => (acc << 16n) | BigInt(x), 0n);
}

export interface ParsedCidr {
  version: 4 | 6;
  /** Network address as written (not masked). */
  address: string;
  prefix: number;
}

/** Parses "a.b.c.d/n" or "v6/n". Returns null when malformed or the length is out of range. */
export function parseCidr(cidr: string): ParsedCidr | null {
  if (typeof cidr !== 'string' || cidr.length > 50) return null;
  const slash = cidr.indexOf('/');
  if (slash < 0 || slash !== cidr.lastIndexOf('/')) return null;
  const address = cidr.slice(0, slash);
  const lenText = cidr.slice(slash + 1);
  if (!/^\d{1,3}$/.test(lenText)) return null;
  const prefix = Number(lenText);
  if (isIPv4(address)) return prefix <= 32 ? { version: 4, address, prefix } : null;
  if (isIPv6(address)) return prefix <= 128 ? { version: 6, address: address.toLowerCase(), prefix } : null;
  return null;
}

/** True when IPv4 `ip` lies inside IPv4 `cidr`. False for malformed input or mixed families. */
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr);
  const a = ipv4ToInt(ip);
  if (!c || c.version !== 4 || a === null) return false;
  const n = ipv4ToInt(c.address);
  if (n === null) return false;
  if (c.prefix === 0) return true;
  const size = 2 ** (32 - c.prefix);
  return Math.floor(a / size) === Math.floor(n / size);
}

/** True when IPv6 `ip` lies inside IPv6 `cidr`. False for malformed input or mixed families. */
export function ipv6InCidr(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr);
  const a = ipv6ToBigInt(ip);
  if (!c || c.version !== 6 || a === null) return false;
  const n = ipv6ToBigInt(c.address);
  if (n === null) return false;
  const shift = BigInt(128 - c.prefix);
  return a >> shift === n >> shift;
}

/** IPv4 octets in reverse order ("192.0.2.1" → ["1","2","0","192"]), or null if not IPv4. */
export function reverseIPv4Labels(ip: string): string[] | null {
  if (!isIPv4(ip)) return null;
  return ip.split('.').reverse();
}

/**
 * The 32 hex nibbles of an IPv6 address in address order
 * ("2001:db8::1" → ["2","0","0","1","0","d","b","8",…,"1"]), or null if not IPv6.
 * Reverse them for ip6.arpa-style names.
 */
export function ipv6Nibbles(ip: string): string[] | null {
  const full = expandIPv6(ip);
  return full ? full.replace(/:/g, '').split('') : null;
}

/**
 * For an IPv4-mapped IPv6 address ("::ffff:192.0.2.1"), the embedded IPv4
 * address; otherwise null.
 */
export function ipv4FromMapped(ip: string): string | null {
  const g = ipv6Groups(ip);
  if (!g || g.slice(0, 5).some((x) => x !== 0) || g[5] !== 0xffff) return null;
  const hi = g[6] ?? 0;
  const lo = g[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}
