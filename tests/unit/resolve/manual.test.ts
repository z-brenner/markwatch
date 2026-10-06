import { describe, expect, it } from 'vitest';
import { manualUrlFor } from '../../../src/core/manual';

describe('manualUrlFor', () => {
  it('dns: "name TYPE", defaulting to NS', () => {
    expect(manualUrlFor('dns', 'acme-login.com MX')).toBe('https://dns.google/query?name=acme-login.com&rr_type=MX');
    expect(manualUrlFor('dns', 'acme-login.com aaaa')).toBe('https://dns.google/query?name=acme-login.com&rr_type=AAAA');
    expect(manualUrlFor('dns', 'acme-login.com')).toBe('https://dns.google/query?name=acme-login.com&rr_type=NS');
    expect(manualUrlFor('dns', 'acme-login.com BOGUS')).toBe('https://dns.google/query?name=acme-login.com&rr_type=NS');
  });

  it('rdap-domain: the exact RDAP URL when there is a service, else the registry WHOIS page', () => {
    expect(manualUrlFor('rdap-domain', 'example.com')).toBe('https://rdap.verisign.com/com/v1/domain/example.com');
    expect(manualUrlFor('rdap-domain', 'acme.io')).toBe('https://www.iana.org/domains/root/db/io.html');
    expect(manualUrlFor('rdap-domain', 'acme.de')).toBe('https://webwhois.denic.de/?lang=en');
  });

  it('rdap-ip: the RIR URL, else IANA WHOIS', () => {
    expect(manualUrlFor('rdap-ip', '193.0.6.139')).toBe('https://rdap.db.ripe.net/ip/193.0.6.139');
    expect(manualUrlFor('rdap-ip', '10.1.2.3')).toBe('https://www.iana.org/whois?q=10.1.2.3');
  });

  it('ct: the human-readable crt.sh page', () => {
    expect(manualUrlFor('ct', 'acme')).toBe('https://crt.sh/?q=acme%25&exclude=expired');
  });

  it('abuse: the Abusix TXT query on Google’s page', () => {
    expect(manualUrlFor('abuse', '8.8.8.8')).toBe('https://dns.google/query?name=8.8.8.8.abuse-contacts.abusix.zone&rr_type=TXT');
  });

  it('never throws on junk', () => {
    for (const kind of ['dns', 'rdap-domain', 'rdap-ip', 'ct', 'abuse'] as const) {
      for (const q of ['', '   ', '<script>', 'x'.repeat(10_000)]) expect(manualUrlFor(kind, q)).toMatch(/^https:\/\//);
    }
  });
});
