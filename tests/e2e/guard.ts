// Privacy guard for every e2e test. Installs, before any app code runs:
//  1. throwing, recording traps on every browser storage / persistence API,
//     on cross-context and file-system APIs (history state, Web Locks, file
//     pickers), and on network channels that CSP connect-src does not fully
//     cover or the app never uses (WebRTC, WebTransport, WebSocket,
//     EventSource);
//  2. a CSP-violation recorder;
//  3. a network router that fails the test on any request to a host outside
//     the allowlist (plus the app's own server and file:// page), and serves
//     allowlisted lookups from mocks (or lets them through in the live project).
// After each test it asserts zero trapped calls, zero CSP violations, zero
// off-allowlist requests, zero uncaught page errors, and an empty window.name
// (which survives navigation and could otherwise carry state across loads).
//
// Not trapped, because the app uses them by design: <a download> with Blob
// URLs (file downloads) and navigator.clipboard.writeText ("Copy text").
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { ALLOWED_HOSTS } from '../../src/data/allowlist';

export type MockHandler = (url: URL, route: Route) => Promise<boolean> | boolean;

const TRAP_SCRIPT = () => {
  const g = window as unknown as { __mwGuard: { storage: string[]; csp: string[] } };
  g.__mwGuard = { storage: [], csp: [] };
  const trap = (name: string) => () => {
    g.__mwGuard.storage.push(name);
    throw new Error(`Markwatch guard: ${name} is forbidden`);
  };
  const def = (obj: object, prop: string, label: string) => {
    try {
      Object.defineProperty(obj, prop, { configurable: false, get: trap(label), set: trap(label) });
    } catch {
      g.__mwGuard.storage.push(`could-not-trap:${label}`);
    }
  };
  for (const p of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'openDatabase']) def(window, p, p);
  def(Document.prototype, 'cookie', 'document.cookie');
  def(Navigator.prototype, 'storage', 'navigator.storage');
  def(Navigator.prototype, 'serviceWorker', 'navigator.serviceWorker');
  def(Navigator.prototype, 'sendBeacon', 'navigator.sendBeacon');
  def(window, 'BroadcastChannel', 'BroadcastChannel');
  def(window, 'SharedWorker', 'SharedWorker');
  def(window, 'open', 'window.open');
  // Web Locks coordinate across tabs; file pickers can persist handles.
  def(Navigator.prototype, 'locks', 'navigator.locks');
  for (const p of ['showSaveFilePicker', 'showOpenFilePicker', 'showDirectoryPicker']) def(window, p, `window.${p}`);
  // History entries survive in the session history; the app has no routes.
  const trapMethod = (obj: object, prop: string, label: string) => {
    try {
      Object.defineProperty(obj, prop, {
        configurable: false,
        writable: false,
        value: function trapped() {
          g.__mwGuard.storage.push(label);
          throw new Error(`Markwatch guard: ${label} is forbidden`);
        },
      });
    } catch {
      g.__mwGuard.storage.push(`could-not-trap:${label}`);
    }
  };
  trapMethod(History.prototype, 'pushState', 'history.pushState');
  trapMethod(History.prototype, 'replaceState', 'history.replaceState');
  // Network channels: WebRTC is not governed by connect-src at all; the others
  // are, but the app has no use for them.
  for (const p of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'WebSocket', 'EventSource']) trapMethod(window, p, `new ${p}`);
  document.addEventListener('securitypolicyviolation', (e) => {
    g.__mwGuard.csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sample} @${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`);
  });
};

interface GuardState {
  offAllowlist: string[];
  unmocked: string[];
  pageErrors: string[];
  requests: string[];
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const test = base.extend<{ guard: GuardState; mock: (h: MockHandler) => void; live: boolean }>({
  live: [false, { option: true }],
  guard: [
    async ({ page, live, baseURL }, use, testInfo) => {
      // The app's own server (vite preview); any other loopback port is off-limits.
      const appPort = new URL(baseURL ?? 'http://localhost:4173').port;
      const state: GuardState = { offAllowlist: [], unmocked: [], pageErrors: [], requests: [] };
      await page.addInitScript(TRAP_SCRIPT);
      page.on('pageerror', (e) => state.pageErrors.push(e.message));
      const handlers: MockHandler[] = (page as Page & { __mwHandlers?: MockHandler[] }).__mwHandlers ?? [];
      (page as Page & { __mwHandlers?: MockHandler[] }).__mwHandlers = handlers;
      await page.context().route('**/*', async (route) => {
        const url = new URL(route.request().url());
        state.requests.push(url.href);
        if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
        if (url.protocol === 'file:' && url.pathname.endsWith('/dist/index.html')) return route.continue();
        if (LOOPBACK.has(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:') && url.port === appPort) return route.continue();
        if (!ALLOWED_HOSTS.has(url.hostname) || url.protocol !== 'https:') {
          state.offAllowlist.push(url.href);
          return route.abort('blockedbyclient');
        }
        if (live) return route.continue();
        for (const h of handlers) if (await h(url, route)) return;
        state.unmocked.push(url.href);
        return route.abort('connectionrefused');
      });
      await use(state);
      const g = await page
        .evaluate(() => ({ ...((window as unknown as { __mwGuard?: { storage: string[]; csp: string[] } }).__mwGuard ?? { storage: [], csp: [] }), windowName: window.name }))
        .catch(() => ({ storage: [] as string[], csp: [] as string[], windowName: '' }));
      await testInfo.attach('requests', { body: state.requests.join('\n') });
      expect(g.storage, 'storage and other trapped APIs must never be touched').toEqual([]);
      expect(g.windowName, 'window.name must stay empty').toBe('');
      expect(g.csp, 'no CSP violations').toEqual([]);
      expect(state.offAllowlist, 'no requests outside the allowlist').toEqual([]);
      expect(state.pageErrors, 'no uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
  mock: async ({ page }, use) => {
    await use((h) => {
      (page as Page & { __mwHandlers?: MockHandler[] }).__mwHandlers?.push(h);
    });
  },
});

export { expect };
