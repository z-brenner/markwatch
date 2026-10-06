# Markwatch

A local-only workbench for domain trademark enforcement, built for in-house legal teams.

You enter a trademark, your primary domain and your inventory. Markwatch then:

1. Finds lookalike and mark-containing domains.
2. Separates out the ones you or your licensees run.
3. Works out who can act on each remaining domain: the registrar, the host, a CDN or a parking company.
4. Recommends a remedy route once you have classified the domain.
5. Produces a draft from a template.

The value is in the triage and the remedy routing, not the scanning.

> **Markwatch does not give legal advice.** Scores are heuristics for ranking. Every draft opens with "DRAFT. Attorney review required before sending." Built-in templates contain clearly marked placeholder legal language that counsel must replace. Template guidance is US-centric (DMCA, ACPA), plus the global UDRP and URS policies.

## Privacy model

**No backend, nothing retained.**

- The build is one static `index.html`. It has no server, accounts, analytics or telemetry.
- It uses no cookies, localStorage, sessionStorage, IndexedDB, Cache API or service worker.
- Lookups are fetched with `cache: 'no-store'`, `credentials: 'omit'` and no Referer.
- State lives in memory. Closing the tab discards it. The only way to keep work is to export a case file (ZIP) and import it later.

**But each lookup discloses what you look up to whoever answers it:**

| Lookup | Who learns what |
|---|---|
| Every request below | The server sees your IP address, your browser's User-Agent, and the `Origin` header: the address the page is served from, or `null` when opened from disk. |
| DNS (DNS over HTTPS) | The resolver (Cloudflare by default; Google only if Cloudflare fails) sees every domain queried. The resolver in turn queries the domain's authoritative nameservers. A registrant who runs their own nameservers can therefore see that someone resolved their domain. Neither resolver passes your network on to those nameservers: Google is queried with `edns_client_subnet=0.0.0.0/0`, and Cloudflare does not send EDNS Client Subnet. |
| RDAP, domain | The registry for that TLD sees the domain. |
| RDAP, IP | The regional internet registry (ARIN, RIPE NCC, APNIC, LACNIC, AFRINIC, or a national registry they refer to) sees the IP address. |
| Certificate search | crt.sh sees your mark (the search term). |
| Abuse contact (Abusix) | The DoH resolver and Abusix's nameservers see the IP address. |
| "Check IANA for updates" (About page, only when clicked) | data.iana.org sees that someone fetched its public RDAP bootstrap file. Nothing you look up is sent. |
| "Open this lookup in a new tab" links | The site opened sees the query. |

**And some traces stay on your own computer, outside the app's control:**

- Pages opened from "open in a new tab" links go into your browser history.
- Downloads go into the browser's download history, and their names say what you worked on: `markwatch-case-<mark>-<time>.zip` for case files, `<template>-<domain>.eml` or `.txt` for drafts.
- "Copy text" puts a draft on the operating system clipboard, which may keep a clipboard history or sync it to your other devices.

The case file's audit log is hash-chained. That makes it **tamper-evident, not tamper-proof**: an edit made outside the app breaks the chain and is flagged on import, but anyone can rewrite the whole chain and recompute every hash. Timestamps come from the local clock.

**How the boundary is enforced:** the page ships a strict Content-Security-Policy `<meta>` tag.

- `default-src 'none'`.
- Inline script and style are allowed only by SHA-256 hash.
- `connect-src` lists exactly the lookup hosts: the two DoH resolvers, crt.sh, data.iana.org (used only by the on-demand bootstrap check), and the RDAP servers named in the IANA RDAP bootstrap, which are generated into [`src/data/allowlist.json`](src/data/allowlist.json).
- The About page lists every allowed host.

Two limitations of a `<meta>` CSP:

- `frame-ancestors` and violation reporting are ignored. If you host the file, also send the CSP as an HTTP header. A sample is in [Hosting](#hosting).
- CSP does not govern top-level navigation, so the "open in new tab" links and `mailto:` links work by design.

## Using it

```bash
npm ci
npm run build          # → dist/index.html (single self-contained file)
```

Open `dist/index.html` straight from disk, or serve it from any static host.

1. **Setup.** Enter your mark(s), primary domain, mark owner, and registrations (typed by you; Markwatch never looks them up or invents them). Add your owned domains and authorized third-party domains; anything on either list is excluded from enforcement and labeled. Add your details for drafts, and adjust discovery settings: cap (default 5,000), techniques, keyboard layouts, TLDs and keywords.
2. **Discover and resolve.**
   - Generate permutations and see the count before anything is resolved.
   - Optionally search certificate transparency.
   - Add domains you already know about.
   - Resolve. NS is queried at the registrable domain to decide registration. Registered domains get A/AAAA/MX/TXT records, a wildcard probe, registry RDAP, and RDAP plus Abusix for each IP. Hosting, DNS, CDN, mail and parking providers are inferred.
3. **Triage.** Domains are sorted by score, and every point shows its reason. Open a domain and classify it as one of eight classes. Markwatch then shows the recommended route, the contacts it found (each with its source), escalation options and warnings.
4. **Draft.** Draft from the templates allowed for that class. Unfilled fields are flagged and block export until you fill or dismiss them (a dismissal is logged with your reason). Export options are `.eml`, `mailto:` or copy. Nothing is ever sent automatically.
5. **Case file.** Export a ZIP containing `case.json` (schema v1), evidence files with SHA-256 hashes, a manifest, and the hash-chained audit log of every lookup and decision.

### When a lookup is blocked

Many registries send CORS headers on success but not on errors. A 429, 502 or 404 page without CORS headers is therefore unreadable to a web page, which cannot see the status code either. Markwatch never shows a blocked lookup as "no data". It shows:

- the reason it can determine:
  - **allowlist** (the host is outside the CSP)
  - **blocked by the browser** (the server is reachable, but its answer is unreadable: CORS, or an error status)
  - **unreachable**
  - **timed out**
  - **rate-limited**
  - **no service** (for example, a TLD without RDAP: .io, .co, .de, .eu, .us, .me, .jp, .cn)
- a link that opens the same lookup in a new tab
- a box to paste the result in by hand

Pasted results are parsed by the same parsers and labeled "entered by user".

"Not in DNS" (NXDOMAIN) is shown as **not delegated**, not "unregistered". Domains on hold or registered without nameservers are absent from DNS. Only a readable registry RDAP 404 shows **available**. Use "Verify top N with RDAP" for the candidates that matter. Registries forbid bulk RDAP querying, so Markwatch does not run it across every candidate.

## Remedy routing

| Classification | Route |
|---|---|
| Phishing or malware | Registrar abuse report (registry RDAP abuse contact) and host abuse report (IP RDAP / Abusix). If a CDN fronts the site, report to the CDN. |
| Copied content | DMCA notice to the host. **A non-dismissible banner states that the DMCA covers copyright, not trademark.** Requires a § 512(f) / *Lenz* fair-use acknowledgment. |
| Cybersquatting, no content | Demand letter, plus a disclosure request (ICANN RDRS, or Registration Data Policy §10). Escalation: UDRP, URS (post-2012 gTLDs, .org/.info/.biz; not .com/.net), ccTLD DRP, ACPA. |
| Parked with ads | Trademark complaint to the parking provider, then demand letter, then UDRP. |
| Offered for sale | Capture evidence, then decide between buying through a broker and UDRP. Demand letter shown with a caution. |
| Possible fair use or criticism | Consult counsel. Outbound templates stay locked until you record that counsel was consulted. |
| Authorized but noncompliant | Internal compliance note **only**. Never a legal threat. |
| Unrelated | No action. The reason is recorded. |

## Configuration

- **Scoring rules:** [`src/config/scoring.rules.ts`](src/config/scoring.rules.ts) is the one file to edit. The ruleset version and its SHA-256 are recorded in every case file.
- **Provider fingerprints:** [`src/config/providers.ts`](src/config/providers.ts). **Parking nameservers:** [`src/config/parking.ts`](src/config/parking.ts).
- **Default TLD swap list and keywords:** [`src/config/tlds.ts`](src/config/tlds.ts), [`src/config/keywords.ts`](src/config/keywords.ts).
- **Templates:** [`templates/`](templates/). The syntax is documented in [`templates/README.md`](templates/README.md). Counsel-approved templates can also be imported at runtime on the Templates page. An import overrides the built-in template with the same id and is saved in the case file.
- **Network allowlist:** run `NODE_USE_ENV_PROXY=1 npm run update-bootstrap` to refresh the IANA RDAP bootstrap snapshot and regenerate `src/data/allowlist.json`. Review the diff, then rebuild.
  - The About page shows the snapshot's publication date and age, and warns when it is more than 90 days old.
  - Its **Check IANA for updates** button runs only when clicked. It fetches IANA's domain bootstrap (`https://data.iana.org/rdap/dns.json`) and compares it with the bundled snapshot. It reports how many TLDs changed RDAP servers, and lists any new RDAP hosts that this build's CSP does not allow. The IP and ASN bootstrap files are not checked.
  - The page cannot update itself, because the CSP is fixed at build time. If the check reports changes, run `npm run update-bootstrap` and rebuild.

## Development

```bash
npm run dev            # dev server (no CSP, since Vite's HMR needs inline scripts)
npm run lint           # ESLint, including the storage-API ban
npm run typecheck
npm test               # Vitest unit tests
npm run test:e2e       # Playwright against the production build, all network mocked
npm run test:live      # opt-in: real lookups for example.com in a real browser
npm run notices        # regenerate THIRD_PARTY_LICENSES.md and src/data/notices.ts (also run by build)
npm run verify         # all of the above except live
```

Test-suite guardrails:

- **Storage and network guard.** Every e2e test runs with throwing, recording traps installed on:
  - storage: localStorage, sessionStorage, indexedDB, caches, cookies, `navigator.storage`, service workers;
  - cross-context state: BroadcastChannel, SharedWorker, `window.open`, `history.pushState`/`replaceState`, `navigator.locks`, the File System Access pickers;
  - network channels outside `fetch`: `navigator.sendBeacon`, WebSocket, EventSource, WebTransport and WebRTC (`RTCPeerConnection`, which CSP `connect-src` does not govern).

  A router fails the test on any request to a host outside the allowlist; loopback is allowed only on the app server's own port. CSP violations, uncaught page errors and a non-empty `window.name` also fail the test. Downloads (`<a download>` with Blob URLs) and `navigator.clipboard.writeText` are used by design and are not trapped.
- **Build check.** The CSP `connect-src` in the built file must equal the allowlist, with no `unsafe-inline` and no external `src`/`href`.
- **License check.** `npm run check:licenses` runs inside `npm run build` and fails on any GPL, AGPL, LGPL, SSPL, EUPL or OSL dependency.
- **License notices.** `npm run notices` runs inside `npm run build`. It regenerates [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and `src/data/notices.ts`, and fails if a bundled package has no license file. The output is deterministic, so commit it.

Live test behind a TLS-intercepting proxy: set `HTTPS_PROXY`, and set `PW_TRUST_SPKI` to the base64 SHA-256 SPKI pin of the proxy CA.

## Architecture

All network collection goes through one `Collector` interface ([`src/collect/Collector.ts`](src/collect/Collector.ts)). Results are typed as `LookupResult`: `ok | not_found | blocked | manual`. A future local companion process can plug in as another Collector without UI changes, for page capture, screenshots, scheduled monitoring, certificate-log streaming or a local classifier. Enabling it requires adding its loopback origin to the CSP at build time.

Browser CORS findings for every endpoint are recorded in [`research/`](research/) and in PLAN.md §4.

## Hosting

If you serve the file rather than opening it from disk, add these headers. Copy the CSP value from the built `index.html`.

```
Content-Security-Policy: <same value as the meta tag>; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

## Licensing and credits

See [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

- Permutation algorithms and lookalike tables are derived from dnstwist (Apache-2.0).
- Some techniques are derived from ail-typo-squatting (BSD-2-Clause). Its Wikipedia-derived word lists were deliberately **not** used.
- The build bundles react, react-dom, scheduler, zod, fflate, punycode, tldts and tldts-core, plus CSS generated by Tailwind CSS. All are MIT-licensed.
- Public Suffix List data (MPL-2.0) is bundled via tldts. The source is at <https://publicsuffix.org/list/>.
- No GPL or AGPL code or dependencies.

The minifier strips license comments, so the built `index.html` carries the notices itself. NOTICE, the Apache License 2.0, the ail-typo-squatting license, every bundled package's license and the Public Suffix List notice are embedded in the file. They are shown on the About page under **Licenses**.
