// Parking-provider nameserver fingerprints (PLAN §17). Edit freely: this is
// data. A match marks the domain as parked (a scoring signal) and, where the
// provider has one, links its trademark complaint process.
import type { ProviderMatch } from '../core/types';
import { hostHasSuffix, normalizeHost } from '../core/net/clean';

export interface ParkingFingerprint {
  id: string;
  name: string;
  /** Label-aligned NS suffixes ("sedoparking.com" matches "ns1.sedoparking.com"). */
  nsSuffix: string[];
  trademarkComplaintUrl?: string;
}

const GODADDY_TM = 'https://supportcenter.godaddy.com/ipclaims/trademark';

export const PARKING: readonly ParkingFingerprint[] = [
  {
    id: 'sedo',
    name: 'Sedo',
    nsSuffix: ['sedoparking.com'],
    trademarkComplaintUrl: 'https://sedo.com/us/about-us/policies/ip-complaint-procedure/',
  },
  { id: 'above', name: 'Above.com', nsSuffix: ['abovedomains.com', 'above.com'] },
  { id: 'godaddy-cashparking', name: 'GoDaddy CashParking', nsSuffix: ['cashparking.com'], trademarkComplaintUrl: GODADDY_TM },
  // Dan.com was folded into Afternic (GoDaddy); its nameservers map here.
  { id: 'afternic', name: 'Afternic (GoDaddy)', nsSuffix: ['afternic.com', 'dan.com'], trademarkComplaintUrl: GODADDY_TM },
  { id: 'parkingcrew', name: 'ParkingCrew', nsSuffix: ['parkingcrew.net'] },
  { id: 'bodis', name: 'Bodis (legacy — shut down Jan 2026)', nsSuffix: ['bodis.com'] },
];

/** The first parking provider (in table order) whose suffix matches any nameserver, or null. */
export function matchParking(ns: string[], table: readonly ParkingFingerprint[] = PARKING): ProviderMatch | null {
  const hosts = ns.map((h) => normalizeHost(h)).filter((h): h is string => !!h);
  for (const p of table) {
    for (const suffix of p.nsSuffix) {
      const hit = hosts.filter((h) => hostHasSuffix(h, suffix));
      if (hit.length === 0) continue;
      const match: ProviderMatch = {
        id: p.id,
        name: p.name,
        role: 'parking',
        evidence: `NS ${hit.join(', ')} ${hit.length === 1 ? 'ends' : 'end'} with .${suffix}`,
      };
      if (p.trademarkComplaintUrl) match.trademarkComplaintUrl = p.trademarkComplaintUrl;
      return match;
    }
  }
  return null;
}
