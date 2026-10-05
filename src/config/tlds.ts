// Derived from dnstwist (https://github.com/elceef/dnstwist), Copyright (c) Marcin Ulikowski, Apache License 2.0.
// Modified: selected from dictionaries/common_tlds.dict and dictionaries/abused_tlds.dict, restricted
// TLDs (gov, edu, mil) removed, ai/shop/live added, regrouped into a fixed order.

/**
 * Default TLD-swap list, editable per case. Order is fixed and meaningful only
 * for display: legacy gTLDs, then new gTLDs that are popular or frequently
 * abused, then ccTLDs (including the generic-use and frequently abused ones).
 * Every entry is an ICANN public suffix open to registration.
 */
export const DEFAULT_TLDS: string[] = [
  // Legacy gTLDs
  'com', 'net', 'org', 'info', 'biz', 'mobi', 'pro',
  // New gTLDs: popular or frequently abused
  'app', 'online', 'site', 'xyz', 'top', 'club', 'link', 'news', 'wiki', 'tips',
  'ooo', 'wang', 'work', 'rest', 'buzz', 'fit', 'shop', 'live',
  // ccTLDs: large markets
  'us', 'ca', 'uk', 'co.uk', 'de', 'fr', 'nl', 'eu', 'es', 'it', 'ch', 'be', 'pl',
  'ru', 'in', 'cn', 'jp', 'sg', 'au', 'br', 'com.br', 'mx',
  // ccTLDs: generic use or frequently abused
  'co', 'io', 'ai', 'me', 'tv', 'cc', 'ly', 'to', 'ga', 'gq', 'tk', 'ml', 'cf',
];
