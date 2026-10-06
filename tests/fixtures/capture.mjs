#!/usr/bin/env node
// Captures the real network responses used as test fixtures by the unit
// tests (parsers) and the Playwright mocked e2e project.
//
//   NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs            # everything
//   NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs crtsh rdap # only some groups
//   node tests/fixtures/capture.mjs readme                         # rewrite README.md only
//
// NODE_USE_ENV_PROXY=1 is needed only behind an HTTPS proxy (Node's fetch
// ignores HTTPS_PROXY without it). Responses are written as pretty JSON at
// predictable paths; manifest.json records URL, HTTP status and capture time
// for every file, and README.md is regenerated from it. Review the diff before
// committing: live data changes (example.com moved to Cloudflare DNS in 2025).
//
// File naming (the e2e mocks rely on it):
//   rdap/domain/<domain>.json             RDAP domain response (any status)
//   rdap/ip/<ip>.json                     RDAP IP network ("::" and ":" → "_" for IPv6)
//   doh/<cloudflare|google>/<name>_<TYPE>.json
//   crtsh/<term>.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRIM_LIMIT = 50 * 1024;
const NONEXISTENT = 'markwatch-nonexistent-7f3kq9.com';

const RDAP_DOMAINS = [
  ['example.com', 'https://rdap.verisign.com/com/v1/', 'Verisign (.com)'],
  [NONEXISTENT, 'https://rdap.verisign.com/com/v1/', 'Verisign 404 for an unregistered .com'],
  [NONEXISTENT.replace(/\.com$/, '.org'), 'https://rdap.publicinterestregistry.org/rdap/', 'PIR 404 for an unregistered .org (JSON error body)'],
  ['wikipedia.org', 'https://rdap.publicinterestregistry.org/rdap/', 'PIR (.org), RFC 9537 redactions'],
  ['google.info', 'https://rdap.identitydigital.services/rdap/', 'Identity Digital (.info)'],
  ['google.ai', 'https://rdap.identitydigital.services/rdap/', 'Identity Digital (.ai)'],
  ['bbc.co.uk', 'https://rdap.nominet.uk/uk/', 'Nominet (.uk)'],
  ['web.dev', 'https://pubapi.registry.google/rdap/', 'Google Registry (.dev)'],
  ['abc.xyz', 'https://rdap.centralnic.com/xyz/', 'CentralNic (.xyz)'],
];

const RDAP_IPS = [
  ['8.8.8.8', 'https://rdap.arin.net/registry/', 'ARIN'],
  ['193.0.6.139', 'https://rdap.db.ripe.net/', 'RIPE NCC'],
  ['1.1.1.1', 'https://rdap.apnic.net/', 'APNIC'],
  ['2606:4700:4700::1111', 'https://rdap.arin.net/registry/', 'ARIN (IPv6)'],
];

const DOH_QUERIES = [
  ...['NS', 'A', 'AAAA', 'MX', 'TXT'].map((t) => ['example.com', t, 'example.com']),
  [NONEXISTENT, 'NS', 'NXDOMAIN'],
  ['pphosted.com', 'MX', 'MX-only domain (no A/AAAA)'],
  ['pphosted.com', 'A', 'MX-only domain: empty A answer, SOA in authority'],
  ['dnssec-failed.org', 'NS', 'deliberately broken DNSSEC → SERVFAIL'],
  ['8.8.8.8.abuse-contacts.abusix.zone', 'TXT', 'Abusix contact for 8.8.8.8 (Google)'],
  ['44.116.133.213.abuse-contacts.abusix.zone', 'TXT', 'Abusix contact for 213.133.116.44 (Hetzner, www.hetzner.com)'],
  [
    '8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.abuse-contacts.abusix.zone',
    'TXT',
    'Abusix contact for 2001:4860:4860::8888 (IPv6 nibbles)',
  ],
];

const CRTSH_TERMS = [['dnsviz', 'prefix search "dnsviz%" (a handful of live certificates)']];

const groups = new Set(process.argv.slice(2));
const want = (g) => groups.size === 0 || groups.has(g);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifestPath = path.join(here, 'manifest.json');
const manifest = await readFile(manifestPath, 'utf8')
  .then((t) => JSON.parse(t))
  .catch(() => ({}));

async function save(rel, url, status, body, note, extra = {}) {
  let json = body;
  let trimmed;
  let text = JSON.stringify(json, null, 2) + '\n';
  if (text.length > TRIM_LIMIT && json && typeof json === 'object' && !Array.isArray(json)) {
    // Notices/remarks are boilerplate legal text; trim them first.
    trimmed = [];
    for (const key of ['notices', 'remarks']) {
      if (Array.isArray(json[key]) && json[key].length > 1) {
        trimmed.push(`${key}: kept 1 of ${json[key].length}`);
        json = { ...json, [key]: json[key].slice(0, 1) };
      }
    }
    text = JSON.stringify(json, null, 2) + '\n';
  }
  const file = path.join(here, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  manifest[rel] = { url, status, capturedAt: new Date().toISOString(), note, ...(trimmed?.length ? { trimmed } : {}), ...extra };
  console.log(`${String(status).padEnd(4)} ${rel} (${text.length} bytes)`);
}

async function getJson(url, headers = {}, timeoutMs = 30000) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  // Verisign answers 404 with an EMPTY body; store it as null and flag it.
  if (text.trim() === '') return { status: res.status, body: null, finalUrl: res.url, emptyBody: true };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url}: HTTP ${res.status}, not JSON: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body, finalUrl: res.url };
}

const RDAP_ACCEPT = { accept: 'application/rdap+json, application/json' };
const ipFile = (ip) => ip.replaceAll(':', '_');

if (want('rdap')) {
  for (const [domain, base, note] of RDAP_DOMAINS) {
    const url = `${base}domain/${domain}`;
    const { status, body, finalUrl, emptyBody } = await getJson(url, RDAP_ACCEPT);
    await save(`rdap/domain/${domain}.json`, url, status, body, note, { ...(finalUrl !== url ? { finalUrl } : {}), ...(emptyBody ? { emptyBody } : {}) });
    await sleep(500);
  }
  for (const [ip, base, note] of RDAP_IPS) {
    const url = `${base}ip/${ip}`;
    const { status, body, finalUrl } = await getJson(url, RDAP_ACCEPT);
    await save(`rdap/ip/${ipFile(ip)}.json`, url, status, body, note, finalUrl !== url ? { finalUrl } : {});
    await sleep(500);
  }
}

if (want('doh')) {
  for (const [name, type, note] of DOH_QUERIES) {
    const q = `name=${encodeURIComponent(name)}&type=${type}`;
    const cf = `https://cloudflare-dns.com/dns-query?${q}`;
    const g = `https://dns.google/resolve?${q}`;
    const a = await getJson(cf, { accept: 'application/dns-json' });
    await save(`doh/cloudflare/${name}_${type}.json`, cf, a.status, a.body, note);
    const b = await getJson(g);
    await save(`doh/google/${name}_${type}.json`, g, b.status, b.body, note);
    await sleep(200);
  }
}

if (want('crtsh')) {
  // crt.sh allows 5 requests/minute/IP and often answers 502 or times out.
  // As of 2026-10-05 a leading "%" is rejected ("Unsupported use of '%'")
  // unless followed by ".", and "%term%" silently returns [] even when
  // matching certificates exist. The prefix form "term%" works; it is what
  // src/core/ct/crtsh.ts builds by default.
  for (const [term, note] of CRTSH_TERMS) {
    const url = `https://crt.sh/?q=${encodeURIComponent(term)}%25&output=json&exclude=expired`;
    for (let attempt = 1; ; attempt++) {
      try {
        const { status, body } = await getJson(url, {}, 60000);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        await save(`crtsh/${term}.json`, url, status, body, note);
        break;
      } catch (e) {
        console.warn(`crt.sh attempt ${attempt} failed: ${e.message}`);
        if (attempt >= 6) throw e;
        await sleep(20000);
      }
    }
  }
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, JSON.stringify(sorted, null, 2) + '\n');

const rows = Object.entries(sorted).map(
  ([file, m]) =>
    `| \`${file}\` | ${m.status} | ${m.capturedAt.slice(0, 10)} | ${m.note}${m.trimmed ? ` (trimmed: ${m.trimmed.join('; ')})` : ''}${m.finalUrl ? ` (redirected to ${m.finalUrl})` : ''}${m.emptyBody ? ' (empty body on the wire; stored as null)' : ''}${m.handWritten ? ' **(hand-written)**' : ''} | ${m.url} |`,
);
const readme = `# Test fixtures

Real responses captured with \`tests/fixtures/capture.mjs\`. Refresh with:

\`\`\`sh
NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs          # all groups
NODE_USE_ENV_PROXY=1 node tests/fixtures/capture.mjs crtsh    # one group: rdap | doh | crtsh
\`\`\`

\`manifest.json\` holds the same data as the table below in machine-readable
form (the Playwright mocks read the HTTP status from it, e.g. the 404 RDAP body,
and \`emptyBody: true\` means the server sent no body at all and the file holds \`null\`).
Bodies are stored exactly as received, pretty-printed. Files over 50 KB would have
their \`notices\`/\`remarks\` arrays trimmed; the table says so when that happened.

**crt.sh query form (checked 2026-10-05):** \`%term%\` returns \`[]\` even when
matching certificates exist, and a leading \`%\` not followed by \`.\` is refused
with "Unsupported use of '%'" (sent as HTTP 200, \`Content-Type: application/json\`,
HTML body). The prefix form \`term%\` works, so that is what is captured and what
\`src/core/ct/crtsh.ts\` builds. Current rows carry \`serial_number\` and
\`result_count\` but no longer \`entry_timestamp\`.

Regenerate this README from \`manifest.json\` without fetching anything:
\`node tests/fixtures/capture.mjs readme\`.

Naming: \`rdap/domain/<domain>.json\`, \`rdap/ip/<ip>.json\` (IPv6 \`:\` → \`_\`),
\`doh/<cloudflare|google>/<name>_<TYPE>.json\`, \`crtsh/<term>.json\`.

| File | HTTP | Captured | What | Source URL |
|---|---|---|---|---|
${rows.join('\n')}
`;
await writeFile(path.join(here, 'README.md'), readme);
