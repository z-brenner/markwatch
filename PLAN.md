# Markwatch — Implementation Plan

Status: **draft for approval. I have written no app code.** Last updated 2026-10-05.

Markwatch is a static, local-only workbench for domain trademark enforcement. The user enters a mark, a primary domain and an inventory. Markwatch finds lookalike domains, separates the user's own domains from everyone else's, works out who can act on each one, recommends a remedy and drafts the paperwork from templates. Nothing is sent automatically and nothing is persisted unless the user exports a case file.

The questions I need answered before I start are in [§16](#16-open-questions). They are short. Everything else in this plan has a default I will use unless you overrule it.

---

## 1. What I verified, and how

Everything in §4 was measured, not assumed. I ran `fetch()` inside real Chromium 141 through Playwright, from an `http://localhost` origin and again from a `file://` origin (origin `null`), against every lookup endpoint. That includes **all 379 RDAP servers in the current IANA bootstrap** (publication 2026-09-30). The probe scripts and raw results are in `research/`.

Caveat: the probes ran from a cloud sandbox behind a TLS-intercepting egress proxy with a shared egress IP. CORS headers pass through unchanged, and curl and the browser agree whenever the server answers 200. The rate limits (429) and upstream 502s I saw may be specific to that shared IP. I could not test Firefox or Safari because only Chromium is installed here.

---

## 2. Architecture

```
┌──────────────────────────── single index.html (all JS/CSS inlined) ───────────────────────────┐
│ CSP <meta>: default-src 'none'; script-src 'sha256-…'; connect-src <generated allowlist> …   │
│                                                                                                │
│  UI (React)  ──►  Case store (in-memory reducer, append-only audit log)                        │
│     │                    ▲                                                                     │
│     ▼                    │ LookupResult<T>  (ok | not_found | blocked | manual)                 │
│  Pipeline: inventory → discovery → resolve → enrich → score → (user classifies) → route → draft│
│     │                                                                                          │
│     ▼                                                                                          │
│  Collector interface  ── BrowserCollector (DoH, RDAP, crt.sh, Abusix-over-DoH)                 │
│                       └─ (later) CompanionCollector → local process for capture/monitoring     │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Source layout

```
src/
  core/                 pure TypeScript with no DOM or fetch; unit-tested in Node
    domain/             normalization, IDNA, registrable-domain (tldts), inventory matching
    permute/            one file per technique + engine.ts (dedupe, tagging, ordering, cap)
    resolve/            registration decision, wildcard detection, provider inference
    rdap/               bootstrap lookup, response parsing (registrar, dates, status, abuse)
    score/              rules engine (evaluates config/scoring.rules.ts)
    route/              remedy routing table + explanations
    draft/              template parser, merge, unfilled-field detection, .eml/mailto builders
    casefile/           schema (zod), ZIP export/import (fflate), SHA-256, audit hash-chain
  collect/
    Collector.ts        interface + LookupResult types
    BrowserCollector.ts DoH/RDAP/crt.sh over fetch, with concurrency and backoff
    blocked.ts          classifies failures (CSP vs CORS/network vs timeout); builds manual-lookup links
    mock/               fixture-backed collector for tests and the demo
  config/
    scoring.rules.ts    THE editable rules file
    providers.ts        NS/IP-org/MX → provider fingerprints (Cloudflare, AWS, GoDaddy DNS, Google Workspace…)
    parking.ts          parking-nameserver patterns
    keywords.ts         risky keywords and dictionary-combo words
    tlds.ts             default TLD-swap list
  data/                 generated at build time, committed: IANA RDAP bootstrap snapshot, CSP allowlist
  ui/                   pages + components
templates/              *.md template files with front-matter and merge fields
scripts/
  update-bootstrap.mjs  refreshes data/ from IANA and regenerates the allowlist
  build-csp.mjs         Vite plugin: hashes the inlined script/style and writes the CSP meta
  check-licenses.mjs    fails the build on any GPL/AGPL/LGPL/SSPL dependency
tests/
  unit/                 Vitest
  e2e/                  Playwright (network fully mocked) + live/ (opt-in)
research/               CORS probe scripts and results (evidence for §4)
NOTICE, THIRD_PARTY_LICENSES.md, README.md, PLAN.md
```

### 2.2 Build: one self-contained HTML file

The spec says the app must work when opened from disk. I checked how Chromium handles that:

- From `file://`, Chromium **blocks external `<script type="module" src>` files**: the page's origin is `null` and cross-origin requests for files are refused.
- Inline module scripts do run.
- Workers loaded from a file path are blocked. A classic worker built from a Blob URL works.

So the build uses `vite-plugin-singlefile` to produce a single `dist/index.html` with all JS and CSS inlined, no code splitting and no workers. Permutation runs in time-sliced chunks on the main thread. That is fast enough, since 5,000 candidates take milliseconds. The same file also works on any static host.

A small custom Vite plugin (`scripts/build-csp.mjs`) computes SHA-256 hashes of the inlined `<script>` and `<style>` and writes the CSP `<meta>`. That means no `'unsafe-inline'`. In dev mode, Vite's HMR needs inline scripts and a websocket, so the CSP is injected only in the production build, and **all e2e tests run against the production build** (`vite preview` and `file://`).

`file://` pages are secure contexts in Chromium (`isSecureContext === true`, verified), so `crypto.subtle` (SHA-256) works there.

### 2.3 Content-Security-Policy

```
default-src 'none';
script-src 'sha256-<inlined bundle>';
style-src 'sha256-<inlined css>';
img-src data: blob:;
connect-src <allowlist, see below>;
base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none';
require-trusted-types-for 'script';
```

**connect-src contains:** `https://cloudflare-dns.com`, `https://dns.google`, `https://crt.sh`, `https://data.iana.org`, the RDAP servers named in the IANA bootstrap (DNS and IP/ASN files), and the RIR referral targets I observed (for example `rdap.registro.br`, which LACNIC redirects to).

CSP is checked on every redirect hop, so redirect targets must be listed too. **How many RDAP hosts belong on this list is blocking question Q1.**

What a meta-tag CSP cannot do, and what I will write in the README:

- `frame-ancestors` and reporting are ignored in a `<meta>` CSP. If you host the app, also send the CSP as an HTTP header. I will ship a sample `_headers` file and nginx config.
- CSP does not govern top-level navigation. The "open this lookup in a new tab" links therefore work, and they disclose the queried domain to the site they open. The UI says so on each link.
- `mailto:` and Blob downloads are not network requests and are not affected.

### 2.4 State, and what "no persistence" means

- One in-memory store: a `useReducer` plus context, so no state library is needed. There is no localStorage, sessionStorage, IndexedDB, cookies, Cache API or service worker.
- A `beforeunload` prompt warns when there are changes that have not been exported. That is a dialog, not storage.
- The only way to keep work is **Export case file (.zip)**. **Import** restores it.

### 2.5 The Collector interface and the "blocked ≠ no data" guarantee

```ts
type LookupResult<T> =
  | { status: 'ok';        data: T; raw: unknown; source: string; at: string }
  | { status: 'not_found'; evidence: string; source: string; at: string }   // only from a READABLE authoritative answer (DNS NXDOMAIN, RDAP 404 body)
  | { status: 'blocked';   reason: 'csp' | 'cors_or_network' | 'unreachable' | 'timeout' | 'unsupported';
                           detail: string; manualUrl?: string; source: string; at: string }
  | { status: 'manual';    data: T; pastedText: string; at: string };        // user-entered, labelled as such everywhere

interface Collector {
  readonly id: string;
  readonly capabilities: ReadonlySet<Capability>;  // 'dns' | 'rdap' | 'ct' | 'abuse' | later: 'capture' | 'screenshot' | 'monitor' | 'classify'
  dns(name: string, type: RRType, o: CallOpts): Promise<LookupResult<DnsAnswer>>;
  rdapDomain(domain: string, o: CallOpts): Promise<LookupResult<RdapDomain>>;
  rdapIp(ip: string, o: CallOpts): Promise<LookupResult<RdapNetwork>>;
  ctSearch(term: string, o: CallOpts): Promise<LookupResult<CtEntry[]>>;
  abuseContact(ip: string, o: CallOpts): Promise<LookupResult<string[]>>;
  capturePage?(url: string, o: CallOpts): Promise<LookupResult<Capture>>;   // out of scope now; the UI checks capabilities
}
```

The `not_found` variant can only be built from a readable response that says "not found". Every failure path returns `blocked`, so the type system enforces the rule.

How a failure is classified:

1. A `securitypolicyviolation` event for that URL means `csp`: our own allowlist blocked it.
2. Otherwise, a second `fetch(url, {mode:'no-cors'})` is attempted.
   - If that opaque request succeeds, the server is reachable but its response was unreadable. That is a CORS failure, or an error status sent without CORS headers.
   - If it also fails, the result is `unreachable`.

I verified this technique against the failing servers. The browser **cannot read the HTTP status** of a response that has no CORS headers, so a 429 looks the same as a CORS block. The UI wording is honest about that: "Blocked by the browser: the server may not allow cross-origin lookups, or it rejected or rate-limited the request. Status is not visible to web pages."

Each blocked lookup shows three things:

- the exact URL as an "open in new tab" link, with a disclosure note
- a paste box. Pasted RDAP JSON or DNS text is parsed by the same parsers and stored as `manual`, with the pasted text kept as evidence.
- a "retry later" queue

The later local companion process gets its own `CompanionCollector`, served from `http://127.0.0.1:<port>`. Turning it on needs a build flag that adds that origin to `connect-src`. The UI needs no changes because it only consumes `LookupResult`s.

---

## 3. Data flow, step by step

1. **Setup.** The user enters the mark (one or more strings), the primary domain, the owned-domain list and the authorized third-party list. Inputs are normalized: lowercase, IDNA to punycode via the `punycode` package for determinism, and reduced to the registrable domain via `tldts`. Owned and authorized entries can be registrable domains or wildcards (`*.acme.com`).
2. **Discovery.** The permutation engine (§5), the crt.sh search and manual input are merged and deduplicated **by registrable domain**. Subdomains such as `login.acme-secure.com` are grouped under their registrable domain and kept as evidence. Inventory matches are removed from enforcement and labeled "Owned" or "Authorized: <licensee>". The count is shown against the cap before anything is resolved.
3. **Resolve** (§6). NS is queried for every candidate. A, AAAA, MX and TXT, plus a wildcard probe, are queried only for registered candidates. This cuts DoH traffic about 5×.
4. **Enrich.** Domain RDAP for each registered domain, IP RDAP and Abusix for each unique IP, then provider inference.
5. **Score** (§7), with an itemized reason for every point.
6. **Classify.** The user picks one of the eight classes. Markwatch never auto-classifies.
7. **Route** (§8), with a recommendation and an explanation.
8. **Draft** (§9) from templates. Export is blocked until every unfilled field is filled or dismissed.
9. **Case file** (§10): export or import as a ZIP.

Every lookup, classification, dismissal and export goes into the audit log.

---

## 4. Endpoints and CORS findings (measured 2026-10-05, Chromium 141)

| Endpoint | Use | Readable from browser? | Notes |
|---|---|---|---|
| `https://cloudflare-dns.com/dns-query?name=…&type=…` + `accept: application/dns-json` | DoH (primary) | ✅ `ACAO: *`, both from localhost and file:// | The `ct=application/dns-json` query-param variant returned **400**; use the Accept header. The IP-literal `https://1.1.1.1/dns-query` was reset by the sandbox proxy, and we don't need it. |
| `https://dns.google/resolve?name=…&type=…` | DoH (fallback) | ✅ `ACAO: *` | NXDOMAIN comes back readable as `Status: 3`. |
| Abusix `…<reversed-ip>.abuse-contacts.abusix.zone TXT`, queried **via the DoH endpoints above** | Network abuse contact | ✅ (via DoH) | No extra host in connect-src. It does disclose the IP to the DoH resolver and to Abusix's nameservers. Terms: see §16 Q5. |
| `https://crt.sh/?q=%25<mark>%25&output=json` | CT substring search | ⚠️ `ACAO: *`, but **unreliable** | The same query timed out after 20 s in one run and returned in about 1 s in another. A large-result query (`%github%`) timed out. `Identity=…&exclude=expired` returned in 3.6 s. The operator's announced limit is **5 requests per minute per IP** (crtsh Google Group, Jun 2023). 502 responses are common and carry no CORS header. Plan: one query per seed, at least 12 s apart, `exclude=expired`, a 60 s timeout, one retry, then the manual fallback. I found no verified free alternative with substring search; Cert Spotter matches exact domains only. |
| `https://data.iana.org/rdap/{dns,ipv4,ipv6,asn}.json` | RDAP bootstrap | ✅ `ACAO: *` | Fetched at runtime to detect drift against the bundled snapshot. |
| **379 domain-RDAP servers** from the IANA bootstrap (1,203 TLDs) | Domain RDAP | ✅ **349 to 352 of 379** on the success path | `research/rdap-cors-sweep.json` has every host. Results for .com/.net (Verisign), .org (PIR), Identity Digital (about 450 TLDs including .info and .ai), CentralNic, Google Registry, Radix, Nominet, .fr, .nl, .ca, .br and .in were all readable, **including their 404 "not found" responses**. |
| Failing on this run (25 hosts, 71 TLDs) | | ❌ | **GMO Registry (.shop and 45 brand TLDs)** and **.au**: HTTP 429 with no CORS header (.au sent `retry-after: 22627`). **CORE-operated TLDs** (.cat, .scot, .eus, .bayern…) and .si: upstream 502 with no CORS header. **TWNIC** (.tw): 426. **.fj**: 404 with no CORS header. .tz: no response. **.kg and .mg are `http://`-only**, so they are excluded as mixed content. In every case curl saw `ACAO: *` on a 200, which is exactly the "terminal proves nothing" trap: **error responses often omit CORS headers.** |
| TLDs with **no RDAP in the IANA bootstrap** | | n/a | **.io, .co, .de, .us, .eu, .me, .jp, .cn** and others. `rdap.org` returns 404 for them too. The UI shows "No RDAP service for .xx", a link to the registry's web WHOIS, and the paste box. These must never read as "unregistered". |
| RIR RDAP: `rdap.arin.net`, `rdap.db.ripe.net`, `rdap.apnic.net`, `rdap.lacnic.net`, `rdap.afrinic.net` | IP owner and abuse contact | ✅ all five, IPv4 and IPv6 | ARIN answers 303 for non-ARIN space and LACNIC answers 307 to `rdap.registro.br`. Both redirects carry `ACAO: *`, but the targets must be in connect-src. |
| Registrar RDAP (GoDaddy, MarkMonitor, Namecheap tested) | Registrar-level detail | ✅ on the 3 tested | Not needed by default. The registry response already includes the registrar's abuse contact (§17: RDAP Response Profile §2.4.5). Registrar hosts number in the hundreds and are not in the bootstrap, so they would be link-out only unless Q1 says otherwise. |
| `https://rdap.org/…` | Redirector | ✅ | Not used. It would add a third party that sees every query, and its redirect targets still have to be in the CSP. |
| `https://example.com/` | (sanity check) | ❌ no ACAO | Expected. Markwatch never fetches websites. Page capture needs the companion process. |

**Consequences for the design:**

1. Websites cannot be fetched from the browser, so "has a website" means "has A/AAAA records", and the UI says exactly that.
2. Error statuses are invisible behind a missing CORS header. Rate limiting is handled with a **conservative fixed budget per RDAP host**: concurrency 1 to 2 and a minimum gap between requests. After the first opaque failure on a host, Markwatch backs off exponentially for that host and offers "retry later". It does not hammer the server.
3. `not_found` comes only from a readable NXDOMAIN or a readable RDAP 404.

---

## 5. Discovery: the permutation engine

Every technique is a pure function `(label, ctx) → string[]` in its own file with its own test file. The engine works like this:

- It runs the techniques in a fixed order and IDNA-encodes each output.
- It validates each output against LDH and length rules (labels of 1 to 63 characters, total of 253 or fewer, no leading or trailing hyphen) and checks it against the per-TLD IDN repertoire.
- It deduplicates while **keeping every technique tag** that produced a candidate (`Map<domain, Set<technique>>`). Iteration order is fixed, so output is deterministic and snapshot-testable.
- It applies the cap last, in a documented priority order: homoglyph → bitsquat → keyboard → omission → … → TLD swap → dictionary. The UI shows "N generated, M kept, K dropped by cap", broken down by technique.

| Tag | Algorithm | Origin |
|---|---|---|
| `omission` | Delete each character. | dnstwist (Apache-2.0) |
| `insertion` | Insert each character's **keyboard neighbours** before and after it. | dnstwist |
| `replacement` | Replace each character with **any** of `[a-z0-9-]`. | ail-typo-squatting technique (BSD-2), clean-room |
| `keyboard` | Replace each character with its **keyboard neighbours** (QWERTY by default; QWERTZ and AZERTY selectable). | dnstwist keyboard maps |
| `transposition` | Swap adjacent characters. | dnstwist |
| `repetition` | Double each character. | dnstwist |
| `vowel-swap` | Swap a vowel for each other vowel. | dnstwist |
| `homoglyph` | Single and multi-character lookalikes (`rn↔m`, `cl↔d`, `vv↔w`, `0↔o`, Unicode confusables), limited to each **TLD's IDN repertoire** so nothing unregistrable is generated. Two rounds, as dnstwist does. | dnstwist glyph tables |
| `bitsquat` | Flip each bit of each character and keep results in `[a-z0-9-]`. | dnstwist |
| `hyphenation` | Insert `-` at each interior position; also strip existing hyphens. | dnstwist + ail |
| `dot-insertion` | Insert `.` at interior positions. **The result usually belongs to a different registrable domain** (`ex.ample.com` lives under `ample.com`). Markwatch resolves at that registrable domain and labels the candidate as such. | dnstwist "subdomain" |
| `tld-swap` | Swap the TLD from an editable list. The default is about 60 common and abused TLDs; an "all IANA TLDs" option warns about the cap. | dnstwist dictionaries (Apache-2.0) |
| `dictionary` | `mark+word`, `mark-word`, `word+mark` and `word-mark` for an editable list (login, support, secure, account, verify, pay, help, app, portal, billing…). | dnstwist algorithm; word list written by me |
| `plural`, `numeral-swap`, `cyrillic` (whole-label script swap) | Optional extras that are cheap and high-signal. | dnstwist / ail (the numeral list is trivial and hand-written) |

**Licensing traps I found and will avoid** (from reading both repos):

- ail-typo-squatting's `common-misspellings.json` and `homophones.txt` are **scraped from Wikipedia (CC BY-SA)**. The repo's BSD license does not cover them. **I will not port them.**
- ail's homoglyph table appears to be copied from dnstwist, so I port the glyph table from **dnstwist under Apache-2.0** with attribution.
- Neither repo has a NOTICE file. Ours credits dnstwist (© Marcin Ulikowski, Apache-2.0) and ail-typo-squatting (© 2022 AIL project, David Cruciani, CIRCL, BSD-2-Clause) and names the specific files derived from each. Ported files carry a header saying "derived from…, modified".

**Mark versus domain label.** If the mark ("Acme Widgets") differs from the primary domain's label (`acme`), the engine runs on each distinct seed (`acme`, `acmewidgets`, `acme-widgets`) and tags each candidate with its seed. Non-ASCII marks ("Café") produce both IDN and ASCII-folded seeds.

---

## 6. Resolution and enrichment

### 6.1 Is it registered? The decision table

The NS query is made **at the registrable domain** (§2 of the spec).

| NS answer | Verdict | Next step |
|---|---|---|
| `Status 0` with NS records | **Registered** | Full enrichment. |
| `Status 0` with no NS, only an SOA from the TLD | **Probably unregistered** | Low priority. |
| `Status 3` (NXDOMAIN) | **Not in the zone** | Shown as "Not delegated", **not** as "unregistered". Domains on `clientHold`, `serverHold`, in redemption, or registered without nameservers are absent from the zone but still registered. For candidates that score high on lexical signals, an optional "Verify with RDAP" button (default: top 50) settles it. Only a readable RDAP 404 shows "Available". |
| `Status 2` (SERVFAIL) | **Registered, broken DNS** (lame delegation, or DNSSEC failure) | Enrich via RDAP. Flag DNSSEC failures (the `AD`/`CD` bits): they are common on expired or hijacked domains. |
| Fetch blocked | **Blocked** | §2.5 flow. Never shown as "unregistered". |

- **Wildcard detection:** query `mw-<random 12 chars>.<domain>` for A and AAAA. If it answers, the zone is wildcard. That matters for interpreting dot-insertion candidates and is a weak parking indicator.
- **DoH budget:** total concurrency 8. Cloudflare is the primary and Google the fallback on failure; spreading queries across both would disclose them to two resolvers. Exponential backoff with jitter. Cancellable, with a progress bar. 5,000 NS queries take about 4 to 5 minutes at this rate.

### 6.2 RDAP

- The bundled bootstrap (`data/`) is the authoritative routing table. The runtime fetch of `data.iana.org` compares publication dates and warns if this build is stale or if new servers exist that are not in the allowlist.
- Fields extracted (RFC 9083 and the ICANN gTLD RDAP Response Profile):
  - `events[registration|expiration|last changed]`
  - `status[]` (clientHold, serverHold, pendingDelete, redemptionPeriod, clientTransferProhibited…)
  - registrar entity: name, IANA ID from `publicIds`
  - **registrar abuse contact**: the nested entity with role `abuse`, its vCard email and tel
  - nameservers
  - registrant org and country when not redacted
  - redaction markers (RFC 9537)
- A per-host budget as in §4. Results are cached **in memory for the session only**.
- RDAP is queried only for domains that resolved as registered, plus verification the user triggers. Verisign's and PIR's RDAP terms prohibit high-volume automated querying, and RIPE caps personal-data objects at 1,000 per day per IP. Running RDAP across all 5,000 candidates is therefore ruled out by design, not only for speed.

### 6.3 IP owner and abuse contacts

- IP RDAP is routed from the IANA ipv4/ipv6 bootstrap. Extracted: the network name, the org entity, and the **abuse** role's email.
- Abusix TXT over DoH is a second source. The query name is the reversed IPv4 octets or the reversed IPv6 nibbles, plus `.abuse-contacts.abusix.zone`. Quotes must be stripped, because Cloudflare returns them and Google does not. Both sources are shown, each labelled. When they disagree, both are presented and neither is picked automatically.
- Abusix asks users to credit the database in their reports, so templates add a source line whenever an Abusix contact is used.

### 6.4 Provider inference (from `config/providers.ts`, editable)

- **DNS host**, from NS patterns: `*.ns.cloudflare.com`, `awsdns-*`, `domaincontrol.com` (GoDaddy), `registrar-servers.com` (Namecheap), `googledomains`/`google`, `azure-dns`, `nsone.net`, …
- **Web host and CDN**, from the IP RDAP org plus known ranges: Cloudflare, Fastly, Akamai, AWS/CloudFront, Google, Azure, Vercel, Netlify, GitHub Pages, Shopify, Wix, Squarespace, …
- **Mail provider**, from MX: Google Workspace, Microsoft 365 (`*.mail.protection.outlook.com`), Zoho, Proofpoint, Mimecast, …

**Important routing nuance:** when the IP belongs to a reverse-proxy CDN (Cloudflare above all), the CDN is not the host. The route then says: "Report to the CDN's abuse process. Cloudflare forwards the report to the origin host but does not reveal the origin." The UI links to the CDN's web form, because those reports are form-only.

---

## 7. Scoring

- **One editable file: `src/config/scoring.rules.ts`.** It is typed, so a broken rule fails `tsc` and the tests. Each rule is declarative:

```ts
{ id: 'recent-registration-30d', points: 30, when: { registeredWithinDays: 30 },
  reason: 'Registered {{days}} days ago (within 30 days)' }
```

- The engine is a pure function `(facts, rules) → { total, items: [{ruleId, points, reason}] }`. The UI shows every line item. The ruleset's version and SHA-256 are written into the case file, so a score can be reproduced later.
- Proposed initial rules. Weights are **placeholders** to tune on real data:

| Signal | Points |
|---|---|
| Registered ≤ 30 days / ≤ 90 days / ≤ 365 days | +30 / +20 / +10 |
| MX present, no A/AAAA (mail-only: a phishing or BEC setup) | +25 |
| MX present, with a website | +5 |
| Parking nameserver (`config/parking.ts`) | +10 |
| Certificate issued ≤ 30 days ago (crt.sh) | +15 |
| Technique: homoglyph, cyrillic or bitsquat | +20 |
| Technique: dictionary combo containing a risky keyword (login, verify, secure, pay, wallet, support…) | +15 each, capped at +30 |
| Wildcard DNS | +5 |
| SERVFAIL, or DNSSEC bogus | +5 |
| **Negative:** NS identical to the primary domain's NS | −40 ("may be yours; check the inventory") |
| **Negative:** unredacted registrant org matches your org name | −50 (same) |
| **Negative:** status includes clientHold or serverHold | −10 ("already suspended") |

- The score ranks domains. It never classifies them. Classification is always the user's decision, and the audit log records who made it and when.

---

## 8. Remedy routing

The user picks a class. Markwatch then recommends a route, shows **why**, lists the contacts it found with their sources, and unlocks only the templates that fit the class.

| Class | Recommended route | Templates unlocked | Hard rules |
|---|---|---|---|
| Phishing or malware | Registrar abuse report (registry-RDAP abuse contact) and host abuse report (IP-RDAP / Abusix). Behind a CDN: the CDN's abuse form. Also listed as link-outs: registry abuse contact, browser blocklists (Google Safe Browsing, Microsoft), APWG. | registrar-abuse, host-abuse, disclosure-request | Urgent banner. Recommends evidence capture before reporting. |
| Copied content | DMCA notice to the host's designated agent (and the CDN's). | dmca, host-abuse | **A banner that cannot be dismissed: "The DMCA covers copyright, not trademark. Use this only for copied text, images or code you own."** Also: a § 512(f) misrepresentation warning and a *Lenz* fair-use-consideration checkbox, which is logged. |
| Cybersquatting, no content | Demand letter to the registrant (via RDRS or a Registration Data Policy §10 request if the registrant is redacted). Escalation: UDRP; **URS** where it applies (all post-2012 gTLDs plus .org, .info and .biz, but **not .com or .net**; suspension only, under a clear-and-convincing standard); the ccTLD's own DRP; ACPA (US). The UI works out URS eligibility from the TLD. | demand-letter, disclosure-request, udrp-annex | Shows the domain's registration date next to the user's mark-rights date, if entered, with a warning about **Reverse Domain Name Hijacking** risk when the domain is older than the mark. |
| Parked with ads | **Proposed:** a trademark complaint to the parking provider to get the ads removed (fast and cheap), then a demand letter. Escalation: UDRP (WIPO Overview 3.0 §2.9 and §3.5: PPC links on a confusing domain). Sedo and GoDaddy (CashParking and Afternic) have documented IP-complaint processes. Bodis shut down in Jan 2026 and Dan.com was folded into Afternic. | demand-letter, disclosure-request, udrp-annex | Parking provider identified from NS. |
| Offered for sale | **Proposed:** capture the evidence first, then a decision card. Option A: buy anonymously through a broker (business decision; compare against UDRP fees). Option B: UDRP. An offer to sell above out-of-pocket costs is listed bad-faith evidence under UDRP ¶4(b)(i). **The demand letter is shown with a caution:** contact can raise the price and an inquiry can look like a negotiation. | udrp-annex, disclosure-request, demand-letter (with caution) | — |
| Possible fair use or criticism | **No outbound template until the user records that counsel has been consulted** (logged acknowledgment). Warning cites *Lamparello v. Falwell*, *Bosley v. Kremer*, *Taubman v. Webfeats*, UDRP ¶4(c)(iii) and WIPO Overview 3.0 §2.6 (criticism sites) and §2.7 (fan sites). Also notes the risk of declaratory-judgment or anti-SLAPP exposure and Streisand effects. | internal-note only until acknowledged | Hard lock. |
| Authorized but noncompliant | Internal compliance note to the relationship owner. | compliance-note **only** | **Never** offers demand, DMCA, UDRP or abuse templates. Enforced in code and in a unit test. |
| Unrelated | **Proposed:** no action. Record the reason and offer "add to an ignore list in this case". | none | — |

Routing is a pure function `(class, facts) → Route` with a table-driven unit test for every class, plus the variants for CDN-fronted, no RDAP, redacted registrant, and new gTLD vs legacy vs ccTLD.

---

## 9. Drafting

### 9.1 Templates

Templates live in `templates/*.md`, with front-matter (`id`, `title`, `classes`, `channel: email|portal|internal`, `to`, `subject`) and a body.

```
---
id: registrar-abuse
channel: email
to: "{{registrar.abuseEmail}}"
subject: "Abuse report: {{domain}} ({{class.label}})"
---
**DRAFT. Attorney review required before sending.**
...
Reported domain: {{domain}}
Registrar: {{registrar.name}} (IANA ID {{registrar.ianaId}})
Trademark registration: {{mark.registrations | required: "Registration number(s) and jurisdiction"}}
[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text] ...
```

- Merge syntax is `{{path}}` with optional `| required: "hint"`. A small hand-written parser and merger: no Handlebars, no `eval`, output is plain text.
- **Unfilled fields** (missing data, empty, or `required` with no value) render as a visible `⟦UNFILLED: hint⟧` marker in the preview. **Export, copy, mailto and .eml stay disabled** until each one is filled or explicitly dismissed. A dismissal is logged with a reason.
- **No invented facts.** Registration numbers, dates of first use, ownership and goods/services come only from user input. Facts from lookups carry their source and timestamp in a footnote, for example "Source: RDAP rdap.verisign.com, 2026-10-05T21:04:11Z".
- Every template starts with the banner **"DRAFT. Attorney review required before sending."** All legal prose is wrapped in `[PLACEHOLDER LEGAL LANGUAGE …]` markers. A unit test checks the banner and the absence of any un-bracketed legal conclusion phrase (a denylist: "constitutes infringement", "in bad faith", "is liable" …).

| Template | Notes |
|---|---|
| `registrar-abuse.md` | Cites the registrar's DNS-abuse obligations as placeholder text for counsel to confirm (§17). |
| `host-abuse.md` | IP, network, evidence list. |
| `dmca-notice.md` | Contains all **six elements of 17 U.S.C. § 512(c)(3)(A)** as labeled sections: (i) signature; (ii) identification of the copyrighted work; (iii) identification of the infringing material and its location; (iv) contact information; (v) good-faith-belief statement; (vi) accuracy statement and, under penalty of perjury, authorization. Each element is a `required` field. |
| `demand-letter.md` | Placeholder language only. Lists remedies sought as user-selected options; no threats are pre-written. |
| `disclosure-request.md` | One template, two channels. **(1) ICANN RDRS** (`channel: portal`). Output is a field-by-field copy sheet that matches the RDRS form, plus the link: category "IP holder", the data elements, a 2,000-character description with a live counter, the legal-basis choice, and up to 5 PDF attachments of 5 MB each. RDRS has no API and covers only participating gTLD registrars, not ccTLDs. **(2) Direct to the registrar** under Registration Data Policy §10, with the §10.2 minimum content as `required` fields. |
| `udrp-annex-outline.md` | Evidence annex outline organized by the three UDRP ¶4(a) elements, auto-listing attached evidence by hash. |
| `compliance-note.md` | Internal and neutral. Uses no legal-threat vocabulary, enforced by the same denylist test inverted. |

Templates are bundled at build time (`import.meta.glob('../templates/*.md', {query:'?raw'})`). See Q4 about runtime overrides.

### 9.2 Leaving the app

- **.eml download.** `X-Unsent: 1`, so Outlook opens it as an editable draft. A text body, with evidence files optionally attached as MIME parts. CR and LF are stripped from every header value to prevent header injection.
- **mailto:** link. Disabled with an explanation when the encoded URL exceeds about 1,900 characters, because clients truncate. mailto cannot carry attachments.
- **Copy to clipboard**, from the user's click.
- Every export event is audit-logged with the template id, the SHA-256 of the exported text, and the list of dismissed fields.

---

## 10. Case file (schema v1)

```
markwatch-case-<mark>-<YYYYMMDDTHHMMSSZ>.zip
├─ case.json             # schemaVersion: 1
├─ evidence/<sha256>-<sanitized-name>
└─ manifest.json         # [{path, sha256, bytes, addedAt}] + case.json sha256
```

`case.json` holds:

- `schemaVersion`, `app {name, version, buildHash}`, `createdAt`, `exportedAt` (all UTC ISO-8601 with `Z`)
- `subject { marks[], primaryDomain, markRights[] (user-entered) }`
- `inventory { owned[], authorized[{domain, party, note}] }`
- `settings { cap, techniques, keyboard, tlds, keywords, resolver }`
- `ruleset { version, sha256 }`
- `domains[ { domain, registrable, techniques[], seeds[], lookups[LookupResult], facts, score{total, items[]}, classification?, route?, drafts[], evidence[sha256…] } ]`
- `auditLog[ { seq, at, actor: 'user'|'system', type, payload, prevHash, hash } ]`

Details:

- **The audit log is append-only and hash-chained**: `hash = SHA-256(prevHash ‖ canonical-JSON(entry))`. It is append-only in the API (no mutation path exists), and import **verifies the chain** and flags any break. Being honest about it: this makes the log *tamper-evident to a casual edit, not tamper-proof*. Anyone can rewrite and re-hash the whole chain. Timestamps come from the local clock and are not a trusted timestamping service (RFC 3161 would need a third-party request, so that is a later option).
- **Import is strict.** Zod schema validation. The entry count and total uncompressed size are capped, as zip-bomb protection. Every evidence file's SHA-256 is recomputed and mismatches are flagged. Imported content is treated as untrusted: React escaping everywhere and no `dangerouslySetInnerHTML`. Unknown future `schemaVersion` values are refused, and older ones go through migration functions with tests.
- Imports and exports are themselves logged.

---

## 11. Privacy model, as the README will state it

- There is no backend. Markwatch's author never receives anything. Nothing is stored by the app: closing the tab discards everything you have not exported.
- **But lookups are not private.** Every DNS query discloses the queried domain to the DoH resolver (Cloudflare, or Google as fallback) and, through it, to the domain's authoritative nameservers. Every RDAP query discloses the domain or IP to that registry or RIR. The crt.sh search discloses the mark to crt.sh (Sectigo). The Abusix lookup discloses IPs. A determined registrant running their own nameservers **can see that someone is resolving their domain**, and a crt.sh query reveals the term searched. Manual "open in new tab" links disclose the query to the site opened.
- The CSP `connect-src` is the enforcement mechanism. The list is in the README and in the About page, generated from the same source file.
- The About page also states that the tool does not give legal advice, that drafts are placeholders requiring attorney review, and that scores are heuristics.

---

## 12. Tests

**Unit (Vitest):**

- Every permutation technique, using known inputs and outputs, the edge cases (one-character labels, hyphens at the edges, IDN, multi-part public suffixes such as `co.uk`), and determinism through a snapshot.
- The engine's dedupe, tag merging and cap ordering.
- The registration decision table.
- RDAP parsing against real captured fixtures (Verisign, PIR, Identity Digital, Nominet, ARIN, RIPE, an RFC 9537 redacted response).
- Every scoring rule; routing for every class and variant; template merging, unfilled detection and the banner/denylist checks.
- .eml header injection and mailto length.
- Case file round-trip, hash-chain verification and tamper detection.

**E2E (Playwright, against the production build, over `vite preview` and `file://`):**

- Every network call is answered from fixtures via `page.route`.
- Scenarios: full happy path; a blocked lookup shows "Blocked" with a link-out and paste box, never "no data"; an NXDOMAIN vs RDAP-verify flow; the cap warning; a fair-use lock; "authorized but noncompliant" offers only the compliance note; unfilled-field export gating; case export → reload → import → identical state.

**Guard test (fails the build):**

1. An `addInitScript` replaces `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches`, `navigator.storage`, `navigator.serviceWorker`, `BroadcastChannel` and `window.open` with **throwing, recording proxies** before any app code runs. The whole e2e suite runs under it and asserts zero calls.
2. `context.route('**/*')` records every request. **Any host outside the allowlist (plus the app's own origin) fails the test.**
3. A unit test asserts that the built `index.html` CSP `connect-src` equals the allowlist module, byte for byte, and that the HTML contains no external `src` or `href`.
4. An ESLint `no-restricted-globals`/`no-restricted-properties` rule covers the same storage APIs at the source level.
5. `scripts/check-licenses.mjs` walks `node_modules` and fails on any GPL, AGPL, LGPL or SSPL license (a dual license with a permissive option passes, but is listed).

**Live test** (opt-in, `MARKWATCH_LIVE=1 npm run test:live`): runs discovery and resolution for `example.com` against the real endpoints in a real browser. It asserts that the records resolve, that IANA's RDAP comes back via Verisign, and that the IP owner and abuse contacts come back. It also re-runs the CORS probe against the core endpoints and writes `research/` output, so CORS drift is caught.

---

## 13. Dependencies (versions from `npm view`, 2026-10-05)

**Runtime (bundled into the HTML):**

| Package | Version | License | Why |
|---|---|---|---|
| react, react-dom | 19.3.0 | MIT | UI |
| tldts | 7.4.x | MIT, **bundles Public Suffix List data, which is MPL-2.0** | registrable domain |
| punycode | 2.3.1 | MIT | deterministic IDNA in Node and the browser |
| fflate | 0.8.3 | MIT | ZIP. Chosen over jszip, which is `MIT OR GPL-3.0`. |
| zod | 4.6.x | MIT | strict validation of imported case files. Hand-rolled validators for an untrusted nested schema are a bug farm. |

**Dev only:**

| Package | Version | License |
|---|---|---|
| vite | 8.3.x | MIT |
| @vitejs/plugin-react | 6.1.x | MIT |
| vite-plugin-singlefile | 2.3.x | MIT |
| typescript | **6.0.3, pinned**. TS 7 is `latest`, but typescript-eslint 8.71 supports `<6.1`. | Apache-2.0 |
| tailwindcss, @tailwindcss/vite | 4.3.x | MIT |
| vitest | 5.0.x | MIT |
| jsdom | 30.x | MIT |
| @testing-library/react / @testing-library/dom | 16.3 / 10.4 | MIT |
| @playwright/test | **1.56.1, pinned** to match this environment's preinstalled Chromium build. It can be bumped wherever browsers can be downloaded. | Apache-2.0 |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals | 10.x / 10.x / 8.71 / 7.1 / 17.x | MIT |
| @types/react, @types/react-dom | 19.3 | MIT |

No hosted fonts: a system font stack. No icon font: a handful of inline SVGs.

**License hygiene:**

- `NOTICE` covers the dnstwist and ail-typo-squatting attributions.
- `THIRD_PARTY_LICENSES.md` is generated and includes PSL MPL-2.0 notice text with a link to the source at publicsuffix.org, which satisfies MPL §3.2 for the executable form.
- The About page links to both.

---

## 14. Order of work and how I'll parallelize

Each step lands as its own commit(s), with its tests green before the next starts.

1. **This plan.** Waiting on your answers.
2. **Scaffold and guardrails first.** Vite, strict TS, Tailwind, ESLint storage ban, single-file build, CSP plugin, the license check, and the empty guard e2e test. Guardrails come before features, so nothing can sneak in.
3. **Permutation engine.** Subagent A writes the techniques and tests in parallel while I write the engine, dedupe, cap and IDN handling. I review every ported file against the dnstwist source for attribution and correctness.
4. **Collector and resolution.** Subagent B captures real RDAP and DoH fixtures and writes parsers. I write `BrowserCollector`, the blocked-classification logic and the decision table.
5. **Scoring and routing.** Pure functions and their tables. I write these myself, because this is where the legal judgment sits.
6. **Templates and export.** Subagent C drafts the templates to the placeholder rules. I write the merge engine and gating, and review every template line by line.
7. **Case file.** Schema, ZIP, hash chain, migration scaffolding.
8. **UI polish.** Full e2e under mocks, the file:// e2e run, the live test, README and About.

Each subagent works on disjoint files with a written spec and must run `npm test` and `tsc` clean before handing back. I review all of it before committing.

---

## 15. Risks and failure modes

| Risk | Impact | Mitigation |
|---|---|---|
| crt.sh timeouts (observed) | CT discovery silently incomplete | Retry once, then **"CT search blocked or timed out"** with a link-out and paste box. Never shown as "0 results". |
| RDAP 429 without CORS headers (observed on GMO and .au) | Looks like a CORS block; retrying makes it worse | Per-host budget and backoff; "retry later" queue; honest wording. |
| A held domain is NXDOMAIN | A registered squat is missed | "Not delegated", never "unregistered"; RDAP verification for top candidates. |
| ccTLDs without RDAP (.io, .co, .de, .eu, .us, .me…) | No registrar or abuse data for popular TLDs | Link-out to registry web WHOIS plus the paste box with a WHOIS text parser for registrar and abuse email. **Worth knowing:** a large share of real squats sit in these TLDs. |
| Stale bundled bootstrap | New registries are blocked by the CSP | Runtime drift warning; `npm run update-bootstrap`; README rebuild instructions. |
| Cloudflare-fronted phishing | The "host" is unknown | The CDN route explains it (§6.4). |
| A DoH resolver changes or rate-limits | Resolution stalls | Automatic fallback to the second resolver, with backoff; the UI shows which resolver answered each lookup. |
| A user mistakes the tool for legal advice | Liability | Banners, placeholder markers, the denylist test, the About page, and the fair-use lock. |
| A big mark (short or common word) produces huge crt.sh results | Timeouts, memory | `exclude=expired`, streaming parse guard, size limit with a warning. |

---

## 16. Open questions

### Blocking: I need these before writing code

**Q1. How wide should `connect-src` be?** This is the one real tension in the spec.

"Resolve the RDAP server from the IANA bootstrap" means potentially **379 different RDAP hosts**, and a CSP cannot allow "whatever IANA says" at runtime.

- **(a) Recommended: generate connect-src at build time from the bundled IANA bootstrap.** That is about 385 hosts (DoH, crt.sh, IANA, 379 domain-RDAP servers, the RIRs and their observed referral targets). It is strict in the sense that every host is an IANA-designated registry or RIR, it is auditable (generated, committed and diffable), and coverage is complete. The cost is a long CSP, and a rebuild is needed when IANA adds a registry.
- **(b) Narrow:** fixed endpoints plus about 20 large RDAP back-ends (Verisign, PIR, Identity Digital, CentralNic, Google, Radix, Nominet, GoDaddy Registry…). .com and .net alone are a large share of all registrations. I have not measured what share of *squats* these 20 cover. Everything else is link-out and paste. It reads better in a security review, but the UX is worse.
- **(c)** Either of the above, plus registrar RDAP hosts for richer registrant data. I don't recommend it: there are hundreds of them, and the registry already returns the registrar's abuse contact.

**Q2. Routes for the three classes you didn't specify.** In §8 I *proposed* routes for parked with ads (parking-provider trademark complaint, then demand, then UDRP), offered for sale (evidence, then a buy-vs-UDRP decision card, with demand discouraged) and unrelated (no action, recorded). Approve or change them.

**Q3. Jurisdiction scope for v1.** DMCA and ACPA are US law. I plan to make the templates and guidance **US-centric**, plus UDRP and URS (global gTLD) and a pointer to the relevant ccTLD dispute policy (Nominet DRS, CIRA CDRP, auDRP, EURid ADR…). Templates would not attempt UK, EU or other national law. Is that right, or do you need, for example, UK/EU letter variants now?

**Q4. Template customization at runtime.** Should in-house teams be able to **load their own counsel-approved templates at runtime**, imported as files, held in memory and saved inside the case file? Or are templates edited only in the repo and rebuilt? I recommend allowing runtime import. Otherwise every legal team must run a build to use its own language. It costs about a day and adds a template-validation step.

### Non-blocking: I'll use these defaults unless you object

- **Q5. Abusix.** Included as a secondary abuse-contact source over DoH. Its terms say the service is free and "as is", may change at any time, and ask for credit in reports. **They do not explicitly address commercial use.** Default: on, with attribution, behind a setting. Tell me if your counsel wants it off.
- **Q6. Resolver.** Cloudflare primary, Google only as fallback, so a typical run discloses to one resolver, not two. The user can switch in settings.
- **Q7. Rules editing.** Developers edit `scoring.rules.ts`. The UI shows the rules read-only, and the case file records the ruleset hash. Runtime rule editing can come later.
- **Q8. Browsers.** Chromium-based browsers (Chrome and Edge, the usual managed-enterprise browsers) are tested. Firefox and Safari are best-effort and untested in this environment.
- **Q9. Mark-rights data.** Entered by the user (registration numbers, jurisdictions, first-use dates). The app never looks up USPTO, EUIPO or WIPO, because that would add hosts to the CSP. A later option.
- **Q10. Evidence capture.** Out of scope as specified. In the meantime the user attaches screenshots or files manually; they are hashed and logged.

---

## 17. Legal and registry facts the templates and routes rely on

These were checked against primary sources on 2026-10-05 unless marked **[unverified]**. They feed UI help text and template placeholders. The templates still contain **no legal conclusions**: citations appear only as "consider" pointers for counsel.

**Statutes, policy and cases**
- **17 U.S.C. § 512(c)(3)(A)** lists the six elements of a DMCA notice. The template's element labels quote them verbatim (source: law.cornell.edu/uscode/text/17/512).
- **§ 512(f)** makes a sender liable for knowingly and materially misrepresenting infringement. *Lenz v. Universal Music Corp.*, 815 F.3d 1145 (9th Cir. 2016) (amended opinion), requires the rights holder to consider fair use before sending. That is why the DMCA flow has a checkbox.
- **15 U.S.C. § 1125(d)**, the ACPA, requires bad-faith intent to profit plus registering, trafficking in or using a confusingly similar domain.
  - (d)(1)(B)(i) lists nine bad-faith factors.
  - (B)(ii) is a safe harbor.
  - (d)(2) allows an in rem action.
- **§ 1117(d)** sets statutory damages of $1,000 to $100,000 per domain name.
- **UDRP ¶4(a)** has three cumulative elements: confusing similarity, no rights or legitimate interests, and registration **and** use in bad faith.
  - **¶4(b)** gives non-exclusive examples of bad faith, including (i) acquiring the domain to sell it for more than out-of-pocket costs and (iv) seeking commercial gain from confusion.
  - **¶4(c)** covers the registrant's legitimate interests, including (iii) noncommercial or fair use.
- **WIPO Jurisprudential Overview 3.0:**
  - §2.6: criticism sites. Under 2.6.2, `<mark>.tld` is generally not protected; under 2.6.3, `<mark>sucks.tld` often is.
  - §2.7: fan sites.
  - §2.9: parked pages with PPC links.
  - §3.1.1: offers to sell.
  - §3.3: passive holding.
  - §3.5: auto-generated PPC content.
- **Criticism and gripe-site cases:** *Lamparello v. Falwell*, 420 F.3d 309 (4th Cir. 2005); *Bosley Medical Institute, Inc. v. Kremer*, 403 F.3d 672 (9th Cir. 2005); *Taubman Co. v. Webfeats*, 319 F.3d 770 (6th Cir. 2003).
- **URS** (Procedure, 21 Feb 2024):
  - Standard: clear and convincing evidence (§8.2).
  - Remedy: **suspension only, never transfer** (§10.2, §10.4).
  - Scope: every post-2012 gTLD, plus **.org, .info and .biz** under their 2019 renewals. **It does not apply to .com or .net.** Whether other legacy TLDs have adopted it is **[unverified]**.
  - Cost: the Forum charges $375 for 1–14 domains (fee schedule dated Aug 2022; recheck before relying on it).

**ICANN registration data**
- **RDRS is still running.**
  - The Board extended it for up to two years, to about Nov or Dec 2027 (Oct 2025 and Mar 2026 resolutions), and did not adopt the SSAD recommendations.
  - **There is no API.** It is a logged-in portal at rdrs.icann.org.
  - Participation is voluntary: 80 registrars, about 46% of domains, at the end of the pilot. **ccTLDs are not covered.**
  - During the pilot, 26% of requests were approved and 55% denied.
  - So the template steers the user to the direct §10 route when the registrar does not participate.
- **The Registration Data Policy** took effect 21 Aug 2025 and was revised 12 May 2026. Under §10:
  - Registrars must publish a disclosure-request process.
  - §10.2 sets the minimum content of a request: identity and contact details, the data elements requested, the legal rights and rationale, a good-faith affirmation, and an agreement to process the data lawfully.
  - Registrars must **acknowledge within 2 business days and respond within 30 calendar days** (§10.5).
  - A denial must give a rationale (§10.6).
  - The template works out the follow-up dates.
- **The gTLD RDAP Response Profile v2.2, §2.4.5** says: "An RDAP server MUST include an entity with the abuse role within the registrar entity which MUST include tel and email members". This applies to registry responses too, so **a single registry RDAP call returns the registrar's abuse email and phone.** That is why Q1 option (c), registrar RDAP, is unnecessary.
- **The 2024 DNS-abuse amendments to the RAA and Registry Agreement** are **[unverified by the research pass]**. The abuse-report template cites them only in a bracketed placeholder for counsel to confirm.

**Operational limits that shape the design**
- **crt.sh** allows 5 requests per minute per IP. 502s and timeouts are common, and there is no SLA.
- **DoH resolvers:**
  - Google DoH allows 1,500 QPS per IP, so it does not constrain us.
  - Cloudflare publishes no number but may throttle "security scanning" patterns.
  - Concurrency 8 is well inside both.
- **RDAP and RIR limits:**
  - **Verisign and PIR** RDAP terms prohibit high-volume automated querying, and PIR throttles per IP.
  - **RIPE** allows 1,000 personal-data objects per day per IP.
  - **ARIN** tarpits at roughly 5–10 queries per second (an informal figure).
  - **LACNIC** allowed 10 per minute and 1,000 per hour in a 2016 deck; the current figure is **[unverified]**.
- **Parking nameservers** for `config/parking.ts`:

  | Provider | Nameservers |
  |---|---|
  | Sedo | `ns1/ns2.sedoparking.com` |
  | Above | `ns1/ns2.abovedomains.com`; legacy `above.com` |
  | GoDaddy CashParking | `ns01/ns02.cashparking.com` |
  | Afternic | `ns1/ns2.afternic.com`; also covers `dan.com` NS |
  | ParkingCrew | `ns1/ns2.parkingcrew.net` |
  | Bodis | marked legacy; shut down Jan 2026 |

  Trade press reports that Google withdrew ads from parked domains in 2025–26 **[unverified]**. If that is right, "parked with ads" will increasingly mean "parked and for sale".
