#!/usr/bin/env node
// Generates the third-party license notices that ship with Markwatch:
//
//   THIRD_PARTY_LICENSES.md   for the repository
//   src/data/notices.ts       compiled into dist/index.html and shown on the
//                             About page ("Licenses")
//
//   npm run notices           (also runs inside npm run build)
//
// Why: the build is one minified HTML file. The minifier drops the license
// comments of bundled packages, and the repository's NOTICE and licenses/
// files do not travel with the HTML. MIT and BSD require the notice to
// accompany copies, Apache-2.0 §4(a) requires a copy of the license with
// object-form derivatives, and MPL-2.0 §3.2 requires telling recipients of
// the executable form where the source is. So the texts are embedded.
//
// What is included:
//  - NOTICE (dnstwist and ail-typo-squatting attributions);
//  - the Apache License 2.0 text (licenses/Apache-2.0.txt), for dnstwist;
//  - the ail-typo-squatting BSD-2-Clause text, extracted from NOTICE;
//  - the LICENSE file of every npm package bundled into the HTML: the
//    transitive closure of package.json "dependencies" (verified against a
//    source-mapped build: react, react-dom, scheduler, zod, fflate, punycode,
//    tldts, tldts-core), plus tailwindcss, whose generated CSS (preflight and
//    utilities) is inlined although it is a build-time dependency;
//  - the Public Suffix List notice (MPL-2.0; the list is compiled into tldts).
//
// Output is deterministic (no timestamps, sorted), so running it twice
// produces no diff. It fails if a bundled package has no license file.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const normalize = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

// Build-time packages whose output is nonetheless inlined into the HTML.
const EXTRA_BUNDLED = ['tailwindcss'];
const EXTRA_REASON = { tailwindcss: 'Generated CSS (preflight and utility classes) is inlined into the page.' };

/** Finds a package directory as Node would, starting from `fromDir`. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`third-party-notices: cannot find package ${name} (from ${fromDir}). Run npm ci.`);
    dir = parent;
  }
}

function bundledPackages() {
  const rootPkg = JSON.parse(read('package.json'));
  const found = new Map(); // dir -> pkg
  const queue = [...Object.keys(rootPkg.dependencies ?? {}), ...EXTRA_BUNDLED].map((name) => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift();
    const dir = resolvePackageDir(name, from);
    if (found.has(dir)) continue;
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    found.set(dir, pkg);
    // tailwindcss's own dependencies are build tools, not inlined output.
    if (EXTRA_BUNDLED.includes(pkg.name)) continue;
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir });
  }
  return [...found.entries()]
    .map(([dir, pkg]) => ({ dir, pkg }))
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name) || a.pkg.version.localeCompare(b.pkg.version));
}

function licenseFile(dir, name) {
  const files = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)([-.].*)?$/i.test(f))
    .sort();
  if (!files.length) throw new Error(`third-party-notices: ${name} has no LICENSE file in ${dir}`);
  return normalize(files.map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n\n'));
}

function repoUrl(pkg) {
  const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const url = (r || pkg.homepage || '')
    .replace(/^git\+/, '')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git(#.*)?$/, '')
    .replace(/#.*$/, '');
  return url.startsWith('https://') ? url : `https://www.npmjs.com/package/${pkg.name}`;
}

function licenseId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  return 'see license text';
}

// --- Gather -----------------------------------------------------------------

const notice = normalize(read('NOTICE'));
const apache = normalize(read('licenses/Apache-2.0.txt'));
if (!apache.includes('Apache License') || !apache.includes('Version 2.0')) throw new Error('third-party-notices: licenses/Apache-2.0.txt is not the Apache 2.0 text');

// The ail-typo-squatting license is reproduced verbatim in NOTICE: from the
// "BSD 2-Clause License" line to the next section rule or the end of file.
const ailStart = notice.indexOf('BSD 2-Clause License');
if (ailStart < 0) throw new Error('third-party-notices: ail-typo-squatting BSD-2-Clause text not found in NOTICE');
const ailEndRule = notice.indexOf('\n=====', ailStart);
const ail = normalize(notice.slice(ailStart, ailEndRule < 0 ? undefined : ailEndRule));
if (!ail.includes('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"')) {
  throw new Error('third-party-notices: ail-typo-squatting license text in NOTICE looks incomplete');
}

const packages = bundledPackages();
const tldts = packages.find((p) => p.pkg.name === 'tldts');
if (!tldts) throw new Error('third-party-notices: tldts is not bundled; revisit the Public Suffix List notice');

const PSL_TEXT = normalize(`
Public Suffix List
https://publicsuffix.org/list/

Markwatch bundles a copy of the Public Suffix List (PSL). The list is
compiled into the data of the npm package tldts@${tldts.pkg.version}, which
Markwatch uses to find the registrable domain of a name. Markwatch does not
modify the list.

The Public Suffix List is subject to the terms of the Mozilla Public License,
v. 2.0. A copy of the MPL is available at https://www.mozilla.org/MPL/2.0/.

Source Code Form: the list, in its preferred form for modification, is
available at https://publicsuffix.org/list/ (public_suffix_list.dat) and in
the repository https://github.com/publicsuffix/list. The MPL-2.0 applies only
to the list data, not to the rest of Markwatch.
`);

/** @type {{ id: string; title: string; version: string | null; license: string; url: string; note: string | null; text: string }[]} */
const entries = [
  {
    id: 'notice',
    title: 'Markwatch NOTICE',
    version: null,
    license: 'Attributions (dnstwist, ail-typo-squatting)',
    url: 'NOTICE',
    note: 'Lists the files derived from dnstwist and ail-typo-squatting and what was modified.',
    text: notice,
  },
  {
    id: 'dnstwist',
    title: 'dnstwist',
    version: '20250130',
    license: 'Apache-2.0',
    url: 'https://github.com/elceef/dnstwist',
    note: 'Copyright 2015-2023 Marcin Ulikowski. Permutation algorithms and lookalike tables are derived from dnstwist (see NOTICE). The full Apache License 2.0 follows.',
    text: apache,
  },
  {
    id: 'ail-typo-squatting',
    title: 'ail-typo-squatting',
    version: '2.7.6',
    license: 'BSD-2-Clause',
    url: 'https://github.com/typosquatter/ail-typo-squatting',
    note: 'Some permutation techniques are ported from ail-typo-squatting (see NOTICE).',
    text: ail,
  },
  ...packages.map(({ dir, pkg }) => ({
    id: `npm:${pkg.name}`,
    title: pkg.name,
    version: pkg.version,
    license: licenseId(pkg),
    url: repoUrl(pkg),
    note: EXTRA_REASON[pkg.name] ?? 'Bundled npm package.',
    text: licenseFile(dir, pkg.name),
  })),
  {
    id: 'public-suffix-list',
    title: 'Public Suffix List',
    version: null,
    license: 'MPL-2.0',
    url: 'https://publicsuffix.org/list/',
    note: `Bundled inside tldts@${tldts.pkg.version}.`,
    text: PSL_TEXT,
  },
];

// --- Write THIRD_PARTY_LICENSES.md -------------------------------------------

const fence = (text) => {
  let f = '```';
  while (text.includes(f)) f += '`';
  return `${f}text\n${text}\n${f}`;
};
const label = (e) => (e.version ? `${e.title} ${e.version}` : e.title);
const md = [
  '# Third-party licenses',
  '',
  '<!-- Generated by scripts/third-party-notices.mjs (npm run notices). Do not edit by hand. -->',
  '',
  'Markwatch is distributed as one self-contained `index.html`. The software and data below are',
  'compiled into that file. The same texts are embedded in the file itself and shown on its',
  '**About & privacy** page, under **Licenses**, so they travel with every copy of the build.',
  '',
  '| Component | Version | License | Source |',
  '|---|---|---|---|',
  ...entries.map((e) => `| ${e.title} | ${e.version ?? ''} | ${e.license} | ${e.url.startsWith('http') ? `<${e.url}>` : `[${e.url}](${e.url})`} |`),
  '',
  ...entries.flatMap((e) => [`## ${label(e)}`, '', `License: ${e.license}. ${e.note ?? ''}`.trim(), '', fence(e.text), '']),
].join('\n');

// --- Write src/data/notices.ts -----------------------------------------------

const ts = [
  '// Generated by scripts/third-party-notices.mjs (npm run notices). Do not edit by hand.',
  '// License texts compiled into dist/index.html and shown on the About page, so that',
  '// the notices travel with the single-file build. Rendered as plain text only.',
  '',
  'export interface LicenseNotice {',
  '  id: string;',
  '  title: string;',
  '  version: string | null;',
  '  license: string;',
  '  url: string;',
  '  note: string | null;',
  '  text: string;',
  '}',
  '',
  `export const NOTICES: readonly LicenseNotice[] = ${JSON.stringify(entries, null, 2)};`,
  '',
].join('\n');

writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), md);
writeFileSync(path.join(root, 'src/data/notices.ts'), ts);
console.log(`third-party notices: ${entries.length} entries (${packages.map((p) => `${p.pkg.name}@${p.pkg.version}`).join(', ')}), ${Buffer.byteLength(ts)} bytes of embedded text`);
