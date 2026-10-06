// "Open this lookup in a new tab" URLs for blocked lookups (PLAN §2.5).
// Top-level navigation is not governed by the CSP, and these pages disclose
// the query to the site they open; the UI says so next to each link.
import { RR_CODES, type LookupKind, type RRType } from './types';
import { manualDnsUrl } from './dns/doh';
import { abusixQueryName } from './dns/abusix';
import { rdapDomainTarget, rdapIpTarget } from './rdap/bootstrap';
import { manualCrtshUrl } from './ct/crtsh';

function isRRType(s: string): s is RRType {
  return Object.prototype.hasOwnProperty.call(RR_CODES, s);
}

/**
 * Manual-lookup URL for a lookup. `query` is what LookupResult.query holds:
 * "name TYPE" for dns (type defaults to NS), a domain for rdap-domain, an IP
 * for rdap-ip and abuse, and the search term for ct.
 */
export function manualUrlFor(kind: LookupKind, query: string): string {
  const q = query.trim();
  switch (kind) {
    case 'dns': {
      const [name = '', rawType = 'NS'] = q.split(/\s+/);
      const type = rawType.toUpperCase();
      return manualDnsUrl(name, isRRType(type) ? type : 'NS');
    }
    case 'rdap-domain': {
      const t = rdapDomainTarget(q);
      return t.kind === 'ok' ? t.url : t.manualUrl;
    }
    case 'rdap-ip': {
      const t = rdapIpTarget(q);
      return t.kind === 'ok' ? t.url : t.manualUrl;
    }
    case 'ct':
      return manualCrtshUrl(q);
    case 'abuse':
      return manualDnsUrl(abusixQueryName(q) ?? q, 'TXT');
  }
}
