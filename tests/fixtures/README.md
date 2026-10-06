# Test fixtures

Real responses captured with `tests/fixtures/capture.mjs`. Refresh with:

```sh
NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs          # all groups
NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs crtsh    # one group: rdap | doh | crtsh
```

`manifest.json` holds the same data as the table below in machine-readable
form (the Playwright mocks read the HTTP status from it, e.g. the 404 RDAP body,
and `emptyBody: true` means the server sent no body at all and the file holds `null`).
Bodies are stored exactly as received, pretty-printed. Files over 50 KB would have
their `notices`/`remarks` arrays trimmed; the table says so when that happened.

**crt.sh query form (checked 2026-10-05):** `%term%` returns `[]` even when
matching certificates exist, and a leading `%` not followed by `.` is refused
with "Unsupported use of '%'" (sent as HTTP 200, `Content-Type: application/json`,
HTML body). The prefix form `term%` works, so that is what is captured and what
`src/core/ct/crtsh.ts` builds. Current rows carry `serial_number` and
`result_count` but no longer `entry_timestamp`.

Regenerate this README from `manifest.json` without fetching anything:
`node tests/fixtures/capture.mjs readme`.

Naming: `rdap/domain/<domain>.json`, `rdap/ip/<ip>.json` (IPv6 `:` → `_`),
`doh/<cloudflare|google>/<name>_<TYPE>.json`, `crtsh/<term>.json`.

| File | HTTP | Captured | What | Source URL |
|---|---|---|---|---|
| `crtsh/dnsviz.json` | 200 | 2026-10-05 | prefix search "dnsviz%" (a handful of live certificates) | https://crt.sh/?q=dnsviz%25&output=json&exclude=expired |
| `doh/cloudflare/44.116.133.213.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 213.133.116.44 (Hetzner, www.hetzner.com) | https://cloudflare-dns.com/dns-query?name=44.116.133.213.abuse-contacts.abusix.zone&type=TXT |
| `doh/cloudflare/8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 2001:4860:4860::8888 (IPv6 nibbles) | https://cloudflare-dns.com/dns-query?name=8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone&type=TXT |
| `doh/cloudflare/8.8.8.8.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 8.8.8.8 (Google) | https://cloudflare-dns.com/dns-query?name=8.8.8.8.abuse-contacts.abusix.zone&type=TXT |
| `doh/cloudflare/dnssec-failed.org_NS.json` | 200 | 2026-10-05 | deliberately broken DNSSEC → SERVFAIL | https://cloudflare-dns.com/dns-query?name=dnssec-failed.org&type=NS |
| `doh/cloudflare/example.com_A.json` | 200 | 2026-10-05 | example.com | https://cloudflare-dns.com/dns-query?name=example.com&type=A |
| `doh/cloudflare/example.com_AAAA.json` | 200 | 2026-10-05 | example.com | https://cloudflare-dns.com/dns-query?name=example.com&type=AAAA |
| `doh/cloudflare/example.com_MX.json` | 200 | 2026-10-05 | example.com | https://cloudflare-dns.com/dns-query?name=example.com&type=MX |
| `doh/cloudflare/example.com_NS.json` | 200 | 2026-10-05 | example.com | https://cloudflare-dns.com/dns-query?name=example.com&type=NS |
| `doh/cloudflare/example.com_TXT.json` | 200 | 2026-10-05 | example.com | https://cloudflare-dns.com/dns-query?name=example.com&type=TXT |
| `doh/cloudflare/markwatch-nonexistent-7f3kq9.com_NS.json` | 200 | 2026-10-05 | NXDOMAIN | https://cloudflare-dns.com/dns-query?name=markwatch-nonexistent-7f3kq9.com&type=NS |
| `doh/cloudflare/pphosted.com_A.json` | 200 | 2026-10-05 | MX-only domain: empty A answer, SOA in authority | https://cloudflare-dns.com/dns-query?name=pphosted.com&type=A |
| `doh/cloudflare/pphosted.com_MX.json` | 200 | 2026-10-05 | MX-only domain (no A/AAAA) | https://cloudflare-dns.com/dns-query?name=pphosted.com&type=MX |
| `doh/google/44.116.133.213.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 213.133.116.44 (Hetzner, www.hetzner.com) | https://dns.google/resolve?name=44.116.133.213.abuse-contacts.abusix.zone&type=TXT |
| `doh/google/8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 2001:4860:4860::8888 (IPv6 nibbles) | https://dns.google/resolve?name=8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone&type=TXT |
| `doh/google/8.8.8.8.abuse-contacts.abusix.zone_TXT.json` | 200 | 2026-10-05 | Abusix contact for 8.8.8.8 (Google) | https://dns.google/resolve?name=8.8.8.8.abuse-contacts.abusix.zone&type=TXT |
| `doh/google/dnssec-failed.org_NS.json` | 200 | 2026-10-05 | deliberately broken DNSSEC → SERVFAIL | https://dns.google/resolve?name=dnssec-failed.org&type=NS |
| `doh/google/example.com_A.json` | 200 | 2026-10-05 | example.com | https://dns.google/resolve?name=example.com&type=A |
| `doh/google/example.com_AAAA.json` | 200 | 2026-10-05 | example.com | https://dns.google/resolve?name=example.com&type=AAAA |
| `doh/google/example.com_MX.json` | 200 | 2026-10-05 | example.com | https://dns.google/resolve?name=example.com&type=MX |
| `doh/google/example.com_NS.json` | 200 | 2026-10-05 | example.com | https://dns.google/resolve?name=example.com&type=NS |
| `doh/google/example.com_TXT.json` | 200 | 2026-10-05 | example.com | https://dns.google/resolve?name=example.com&type=TXT |
| `doh/google/markwatch-nonexistent-7f3kq9.com_NS.json` | 200 | 2026-10-05 | NXDOMAIN | https://dns.google/resolve?name=markwatch-nonexistent-7f3kq9.com&type=NS |
| `doh/google/pphosted.com_A.json` | 200 | 2026-10-05 | MX-only domain: empty A answer, SOA in authority | https://dns.google/resolve?name=pphosted.com&type=A |
| `doh/google/pphosted.com_MX.json` | 200 | 2026-10-05 | MX-only domain (no A/AAAA) | https://dns.google/resolve?name=pphosted.com&type=MX |
| `rdap/domain/abc.xyz.json` | 200 | 2026-10-05 | CentralNic (.xyz) | https://rdap.centralnic.com/xyz/domain/abc.xyz |
| `rdap/domain/bbc.co.uk.json` | 200 | 2026-10-05 | Nominet (.uk) | https://rdap.nominet.uk/uk/domain/bbc.co.uk |
| `rdap/domain/example.com.json` | 200 | 2026-10-05 | Verisign (.com) | https://rdap.verisign.com/com/v1/domain/example.com |
| `rdap/domain/google.ai.json` | 200 | 2026-10-05 | Identity Digital (.ai) | https://rdap.identitydigital.services/rdap/domain/google.ai |
| `rdap/domain/google.info.json` | 200 | 2026-10-05 | Identity Digital (.info) | https://rdap.identitydigital.services/rdap/domain/google.info |
| `rdap/domain/markwatch-nonexistent-7f3kq9.com.json` | 404 | 2026-10-05 | Verisign 404 for an unregistered .com (empty body on the wire; stored as `null`) | https://rdap.verisign.com/com/v1/domain/markwatch-nonexistent-7f3kq9.com |
| `rdap/domain/markwatch-nonexistent-7f3kq9.org.json` | 404 | 2026-10-05 | PIR 404 for an unregistered .org (JSON error body) | https://rdap.publicinterestregistry.org/rdap/domain/markwatch-nonexistent-7f3kq9.org |
| `rdap/domain/web.dev.json` | 200 | 2026-10-05 | Google Registry (.dev) | https://pubapi.registry.google/rdap/domain/web.dev |
| `rdap/domain/wikipedia.org.json` | 200 | 2026-10-05 | PIR (.org), RFC 9537 redactions | https://rdap.publicinterestregistry.org/rdap/domain/wikipedia.org |
| `rdap/ip/1.1.1.1.json` | 200 | 2026-10-05 | APNIC | https://rdap.apnic.net/ip/1.1.1.1 |
| `rdap/ip/193.0.6.139.json` | 200 | 2026-10-05 | RIPE NCC | https://rdap.db.ripe.net/ip/193.0.6.139 |
| `rdap/ip/2606_4700_4700__1111.json` | 200 | 2026-10-05 | ARIN (IPv6) | https://rdap.arin.net/registry/ip/2606:4700:4700::1111 |
| `rdap/ip/8.8.8.8.json` | 200 | 2026-10-05 | ARIN | https://rdap.arin.net/registry/ip/8.8.8.8 |
