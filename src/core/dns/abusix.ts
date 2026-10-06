// Abusix abuse-contact database, queried as TXT over DoH (PLAN §6.3).
// Query name: reversed IPv4 octets or reversed IPv6 nibbles + the zone suffix.
// Abusix asks that reports credit the database; templates add a source line.
import type { DnsAnswer } from '../types';
import { uniq } from '../util';
import { ipv6Nibbles, reverseIPv4Labels } from '../net/ip';
import { normalizeEmail } from '../net/clean';
import { txtRecords } from './doh';

export const ABUSIX_ZONE = 'abuse-contacts.abusix.zone';

/**
 * "192.0.2.1" → "1.2.0.192.abuse-contacts.abusix.zone"; IPv6 uses all 32
 * nibbles, reversed. Returns null when `ip` is not an IP address.
 */
export function abusixQueryName(ip: string): string | null {
  const v4 = reverseIPv4Labels(ip.trim());
  if (v4) return `${v4.join('.')}.${ABUSIX_ZONE}`;
  const v6 = ipv6Nibbles(ip.trim());
  if (v6) return `${v6.reverse().join('.')}.${ABUSIX_ZONE}`;
  return null;
}

/**
 * Abuse emails from an Abusix TXT answer. Each TXT string may hold several
 * comma-separated addresses. Output is trimmed, lowercased, deduplicated and
 * limited to plausible addresses. A non-NOERROR answer yields [].
 */
export function parseAbusixTxt(answer: DnsAnswer): string[] {
  if (answer.rcode !== 0) return [];
  const out: string[] = [];
  for (const txt of txtRecords(answer)) {
    for (const part of txt.split(/[,;\s]+/).slice(0, 50)) {
      const e = normalizeEmail(part);
      if (e) out.push(e);
    }
  }
  return uniq(out);
}
