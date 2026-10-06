// Provider fingerprints: nameserver, mail-exchanger and IP-network patterns
// that identify who hosts DNS, web and mail for a domain (PLAN §6.4).
// Edit freely: this is data, read by src/core/resolve/providers.ts.
//
// Matching rules:
//  - nsSuffix / mxSuffix are label-aligned host suffixes: "domaincontrol.com"
//    matches "ns01.domaincontrol.com" but not "notdomaincontrol.com".
//  - nsRegex is for patterns that are not suffixes (Route 53's "awsdns-NN").
//  - orgRegex is tested against the IP network's holder (RDAP registrant
//    org) and the network name.
// The first matching entry wins within a role, so put specific entries before
// broad ones (Linode before Akamai, Google Cloud DNS before Google).
// abuseUrl is set only where the public abuse-report URL is known for certain;
// otherwise the RDAP abuse contact of the network is used.
import type { ProviderRole } from '../core/types';

export interface ProviderFingerprint {
  id: string;
  name: string;
  role: ProviderRole;
  match: {
    nsSuffix?: string[];
    nsRegex?: RegExp;
    mxSuffix?: string[];
    orgRegex?: RegExp;
  };
  abuseUrl?: string;
  abuseEmail?: string;
  /** Reverse proxy / CDN: the origin host is hidden behind it. */
  hidesOrigin?: boolean;
}

/** DNS hosting, by nameserver. */
export const DNS_PROVIDERS: readonly ProviderFingerprint[] = [
  { id: 'cloudflare-dns', name: 'Cloudflare DNS', role: 'dns', match: { nsSuffix: ['ns.cloudflare.com', 'foundationdns.com', 'foundationdns.net', 'foundationdns.org'] } },
  { id: 'route53', name: 'Amazon Route 53', role: 'dns', match: { nsRegex: /(^|\.)awsdns-\d+\.[a-z.]+$/ } },
  { id: 'godaddy-dns', name: 'GoDaddy DNS', role: 'dns', match: { nsSuffix: ['domaincontrol.com'] } },
  { id: 'namecheap-dns', name: 'Namecheap DNS', role: 'dns', match: { nsSuffix: ['registrar-servers.com'] } },
  { id: 'google-cloud-dns', name: 'Google Cloud DNS', role: 'dns', match: { nsRegex: /^ns-cloud-[a-z]\d+\.googledomains\.com$/ } },
  { id: 'google-domains-dns', name: 'Google Domains / Squarespace Domains DNS', role: 'dns', match: { nsSuffix: ['googledomains.com'] } },
  { id: 'google-dns', name: 'Google (own nameservers)', role: 'dns', match: { nsSuffix: ['google.com', 'zdns.google'] } },
  { id: 'azure-dns', name: 'Azure DNS', role: 'dns', match: { nsRegex: /(^|\.)azure-dns\.(com|net|org|info)$/ } },
  { id: 'ns1', name: 'NS1 (IBM)', role: 'dns', match: { nsSuffix: ['nsone.net'] } },
  { id: 'akamai-dns', name: 'Akamai Edge DNS', role: 'dns', match: { nsSuffix: ['akam.net'] } },
  { id: 'digitalocean-dns', name: 'DigitalOcean DNS', role: 'dns', match: { nsSuffix: ['digitalocean.com'] } },
  { id: 'hetzner-dns', name: 'Hetzner DNS', role: 'dns', match: { nsSuffix: ['ns.hetzner.com', 'ns.hetzner.de', 'first-ns.de', 'second-ns.de', 'second-ns.com'] } },
  { id: 'ovh-dns', name: 'OVHcloud DNS', role: 'dns', match: { nsSuffix: ['ovh.net', 'ovh.ca', 'anycast.me'] } },
  { id: 'gandi-dns', name: 'Gandi LiveDNS', role: 'dns', match: { nsSuffix: ['gandi.net'] } },
  { id: 'porkbun-dns', name: 'Porkbun DNS', role: 'dns', match: { nsSuffix: ['ns.porkbun.com'] } },
  { id: 'wix-dns', name: 'Wix DNS', role: 'dns', match: { nsSuffix: ['wixdns.net'] } },
  { id: 'vercel-dns', name: 'Vercel DNS', role: 'dns', match: { nsSuffix: ['vercel-dns.com'] } },
  { id: 'linode-dns', name: 'Linode (Akamai) DNS', role: 'dns', match: { nsSuffix: ['linode.com'] } },
  { id: 'vultr-dns', name: 'Vultr DNS', role: 'dns', match: { nsSuffix: ['vultr.com'] } },
  { id: 'dynadot-dns', name: 'Dynadot DNS', role: 'dns', match: { nsSuffix: ['dyna-ns.net'] } },
  { id: 'namecom-dns', name: 'Name.com DNS', role: 'dns', match: { nsSuffix: ['name.com'] } },
  { id: 'hover-dns', name: 'Hover (Tucows) DNS', role: 'dns', match: { nsSuffix: ['hover.com'] } },
  { id: 'ionos-dns', name: 'IONOS DNS', role: 'dns', match: { nsSuffix: ['ui-dns.com', 'ui-dns.de', 'ui-dns.org', 'ui-dns.biz'] } },
  { id: 'bluehost-dns', name: 'Bluehost (Newfold Digital) DNS', role: 'dns', match: { nsSuffix: ['bluehost.com'] } },
  { id: 'hostinger-dns', name: 'Hostinger DNS', role: 'dns', match: { nsSuffix: ['dns-parking.com'] } },
  { id: 'netsol-dns', name: 'Network Solutions DNS', role: 'dns', match: { nsSuffix: ['worldnic.com'] } },
];

/** Web hosting and CDNs, by the holder of the IP network. */
export const WEB_PROVIDERS: readonly ProviderFingerprint[] = [
  { id: 'cloudflare', name: 'Cloudflare', role: 'cdn', match: { orgRegex: /cloudflare/i }, abuseUrl: 'https://abuse.cloudflare.com/', hidesOrigin: true },
  { id: 'fastly', name: 'Fastly', role: 'cdn', match: { orgRegex: /fastly/i }, hidesOrigin: true },
  // Linode is part of Akamai; its networks may name either. Check Linode first.
  { id: 'linode', name: 'Linode (Akamai Cloud)', role: 'web', match: { orgRegex: /linode/i } },
  { id: 'akamai', name: 'Akamai', role: 'cdn', match: { orgRegex: /akamai/i }, hidesOrigin: true },
  { id: 'aws', name: 'Amazon Web Services (incl. CloudFront)', role: 'web', match: { orgRegex: /amazon|\baws\b/i } },
  { id: 'google-cloud', name: 'Google', role: 'web', match: { orgRegex: /\bgoogle\b/i } },
  { id: 'azure', name: 'Microsoft Azure', role: 'web', match: { orgRegex: /microsoft|azure/i } },
  { id: 'digitalocean', name: 'DigitalOcean', role: 'web', match: { orgRegex: /digitalocean/i } },
  { id: 'hetzner', name: 'Hetzner', role: 'web', match: { orgRegex: /hetzner/i } },
  { id: 'ovh', name: 'OVHcloud', role: 'web', match: { orgRegex: /\bovh/i } },
  // Vultr's networks are registered to The Constant Company (formerly Choopa).
  { id: 'vultr', name: 'Vultr', role: 'web', match: { orgRegex: /vultr|choopa|constant company/i } },
  { id: 'vercel', name: 'Vercel', role: 'web', match: { orgRegex: /vercel/i } },
  { id: 'netlify', name: 'Netlify', role: 'web', match: { orgRegex: /netlify/i } },
  { id: 'github', name: 'GitHub', role: 'web', match: { orgRegex: /github/i } },
  { id: 'shopify', name: 'Shopify', role: 'web', match: { orgRegex: /shopify/i } },
  { id: 'wix', name: 'Wix', role: 'web', match: { orgRegex: /\bwix(\.com)?\b/i } },
  { id: 'squarespace', name: 'Squarespace', role: 'web', match: { orgRegex: /squarespace/i } },
  { id: 'automattic', name: 'Automattic (WordPress.com)', role: 'web', match: { orgRegex: /automattic/i } },
];

/** Mail hosting, by MX host. */
export const MAIL_PROVIDERS: readonly ProviderFingerprint[] = [
  { id: 'google-workspace', name: 'Google Workspace', role: 'mail', match: { mxSuffix: ['google.com', 'googlemail.com'] } },
  { id: 'microsoft-365', name: 'Microsoft 365', role: 'mail', match: { mxSuffix: ['mail.protection.outlook.com'] } },
  { id: 'zoho-mail', name: 'Zoho Mail', role: 'mail', match: { mxSuffix: ['zoho.com', 'zoho.eu', 'zoho.in', 'zoho.com.au'] } },
  { id: 'proofpoint', name: 'Proofpoint', role: 'mail', match: { mxSuffix: ['pphosted.com', 'ppe-hosted.com'] } },
  { id: 'mimecast', name: 'Mimecast', role: 'mail', match: { mxSuffix: ['mimecast.com'] } },
  { id: 'fastmail', name: 'Fastmail', role: 'mail', match: { mxSuffix: ['messagingengine.com'] } },
  { id: 'yandex-mail', name: 'Yandex Mail', role: 'mail', match: { mxSuffix: ['yandex.net', 'yandex.ru'] } },
  { id: 'icloud-mail', name: 'iCloud Mail', role: 'mail', match: { mxSuffix: ['mail.icloud.com'] } },
  { id: 'proton-mail', name: 'Proton Mail', role: 'mail', match: { mxSuffix: ['protonmail.ch'] } },
  { id: 'namecheap-private-email', name: 'Namecheap Private Email', role: 'mail', match: { mxSuffix: ['privateemail.com'] } },
  { id: 'godaddy-mail', name: 'GoDaddy email', role: 'mail', match: { mxSuffix: ['secureserver.net'] } },
];
