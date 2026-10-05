// Browser CORS probe: runs fetch() inside Chromium from a given page origin and
// records (a) whether JS could read the response, (b) the raw network outcome.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

const mode = process.argv[2] || 'http'; // 'http' | 'file'
const targets = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); // [{id,url,headers?}]
const out = process.argv[4];

let server, pageUrl;
if (mode === 'http') {
  server = http.createServer((_, res) => { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>probe</title>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  pageUrl = `http://localhost:${server.address().port}/`;
} else {
  fs.writeFileSync('blank.html', '<!doctype html><title>probe</title>');
  pageUrl = 'file://' + process.cwd() + '/blank.html';
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: { server: process.env.HTTPS_PROXY },
  // Trust only the sandbox's interception CA (scoped by SPKI), equivalent to installing it.
  args: ['--ignore-certificate-errors-spki-list=PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0='],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: false });
const page = await ctx.newPage();
const net = {};
page.on('response', async r => { const u = r.url(); (net[u] ??= []).push({ status: r.status(), acao: r.headers()['access-control-allow-origin'] ?? null, location: r.headers()['location'] ?? null }); });
page.on('requestfailed', r => { (net[r.url()] ??= []).push({ failed: r.failure()?.errorText }); });
await page.goto(pageUrl);
const secure = await page.evaluate(() => ({ isSecureContext, origin: location.origin, subtle: !!crypto.subtle }));

const results = await page.evaluate(async (targets) => {
  const one = async (t) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    const t0 = performance.now();
    try {
      const r = await fetch(t.url, { headers: t.headers || {}, signal: ctl.signal, redirect: 'follow' });
      const body = await r.text();
      return { id: t.id, url: t.url, js: 'readable', status: r.status, finalUrl: r.url, ms: Math.round(performance.now()-t0), bodyHead: body.slice(0, 160) };
    } catch (e) {
      return { id: t.id, url: t.url, js: ctl.signal.aborted ? 'timeout' : 'blocked', error: String(e), ms: Math.round(performance.now()-t0) };
    } finally { clearTimeout(timer); }
  };
  const res = []; let i = 0;
  const worker = async () => { while (i < targets.length) { const t = targets[i++]; res.push(await one(t)); } };
  await Promise.all(Array.from({ length: 12 }, worker));
  return res;
}, targets);

for (const r of results) r.net = net[r.url] ?? null;
fs.writeFileSync(out, JSON.stringify({ mode, pageUrl, secure, ua: await page.evaluate(() => navigator.userAgent), results }, null, 1));
await browser.close(); server?.close();
console.log(mode, secure, results.length);
