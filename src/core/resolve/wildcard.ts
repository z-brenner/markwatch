// Wildcard DNS detection (PLAN §6.1): query A/AAAA for a random label under
// the domain. An answer means the zone answers every name, which matters for
// dot-insertion candidates and is a weak parking signal.
import type { DnsAnswer } from '../types';
import { RR_CODES } from '../types';
import { isIPv4, isIPv6 } from '../net/ip';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** "mw-<12 random lowercase alphanumerics>.<domain>". `random` must return values in [0, 1). */
export function wildcardProbeName(domain: string, random: () => number = Math.random): string {
  let label = '';
  for (let i = 0; i < 12; i++) {
    const r = random();
    const idx = Number.isFinite(r) ? Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(r * ALPHABET.length))) : 0;
    label += ALPHABET[idx];
  }
  return `mw-${label}.${domain.trim().toLowerCase().replace(/\.$/, '')}`;
}

/** True when the probe answered NOERROR with at least one valid A or AAAA record. */
export function isWildcard(answer: DnsAnswer): boolean {
  if (answer.rcode !== 0) return false;
  return answer.answers.some((r) => (r.type === RR_CODES.A && isIPv4(r.data)) || (r.type === RR_CODES.AAAA && isIPv6(r.data)));
}
