import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs';
const urls = JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const ua = process.argv[3];
const server = http.createServer((_, res) => { res.setHeader('content-type','text/html'); res.end('<!doctype html>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY }, args: ['--ignore-certificate-errors-spki-list=PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0='] });
const ctx = await browser.newContext(ua ? { userAgent: ua } : {}); const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
const info = {};
cdp.on('Network.requestWillBeSent', e => { info[e.requestId] = { url: e.request.url }; });
cdp.on('Network.responseReceived', e => { Object.assign(info[e.requestId] ??= {}, { status: e.response.status, acao: e.response.headers['access-control-allow-origin'] ?? e.response.headers['Access-Control-Allow-Origin'] }); });
cdp.on('Network.loadingFailed', e => { Object.assign(info[e.requestId] ??= {}, { err: e.errorText, cors: e.corsErrorStatus?.corsError, blocked: e.blockedReason }); });
await page.goto(`http://localhost:${server.address().port}/`);
const js = await page.evaluate(async (urls) => Promise.all(urls.map(async u => { try { const r = await fetch(u); return [u, 'ok ' + r.status]; } catch (e) { 
  // no-cors probe: opaque success => server reachable, so failure above was CORS/status-without-ACAO
  try { await fetch(u, { mode: 'no-cors' }); return [u, 'cors-fail, no-cors reachable']; } catch { return [u, 'cors-fail, no-cors ALSO fails (network)']; } } })), urls);
console.log('UA:', ua ? 'desktop' : 'headless-default');
for (const [u, r] of js) { const i = Object.values(info).filter(x => x.url === u); console.log(r.padEnd(40), u, JSON.stringify(i.map(({url, ...x}) => x))); }
await browser.close(); server.close();
