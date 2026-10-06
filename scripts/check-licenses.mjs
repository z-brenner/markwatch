#!/usr/bin/env node
// Fails if any installed package (direct or transitive) is licensed under a
// copyleft license we have ruled out: GPL, AGPL, LGPL, SSPL, EUPL, or OSL.
// A dual license that offers a permissive alternative (e.g. "MIT OR GPL-3.0")
// passes but is reported, because we elect the permissive option.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const FORBIDDEN = /\b(A?GPL|LGPL|SSPL|EUPL|OSL)\b/i;
const root = path.join(process.cwd(), 'node_modules');

async function* packages(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.name.startsWith('@')) {
      yield* packages(p);
      continue;
    }
    yield p;
    yield* packages(path.join(p, 'node_modules'));
  }
}

function licenseString(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

// An SPDX expression passes if at least one OR-branch contains no forbidden license.
function acceptable(expr) {
  const branches = expr.replace(/[()]/g, '').split(/\s+OR\s+/i);
  return branches.some((b) => !FORBIDDEN.test(b));
}

const bad = [];
const dual = [];
const unknown = [];
let count = 0;
for await (const dir of packages(root)) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (!pkg.name) continue;
  count++;
  const lic = licenseString(pkg);
  const id = `${pkg.name}@${pkg.version}: ${lic}`;
  if (lic === 'UNKNOWN') unknown.push(id);
  else if (!acceptable(lic)) bad.push(id);
  else if (FORBIDDEN.test(lic)) dual.push(id);
}

for (const d of dual) console.log(`dual-licensed (permissive option elected): ${d}`);
for (const u of unknown) console.log(`no license field (review manually): ${u}`);
if (bad.length) {
  console.error(`\nForbidden licenses found:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`license check passed: ${count} packages scanned`);
