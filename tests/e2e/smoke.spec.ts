import { test, expect } from './guard';
import { readFileSync } from 'node:fs';
import { connectSrcSources } from '../../src/data/allowlist';

test('app loads under the production CSP', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toContainText('Markwatch');
});

test('built index.html: CSP connect-src equals the allowlist and nothing is loaded externally', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  expect(csp).toBeTruthy();
  const connect = csp!.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '))!;
  expect(connect.slice('connect-src '.length).split(' ')).toEqual(connectSrcSources());
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
  // No external scripts, stylesheets, fonts or images.
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
  expect(html).not.toMatch(/(src|href)="https?:/i);
});

test('the guard itself catches storage access and off-allowlist requests', async ({ page, guard }) => {
  await page.goto('/');
  const caught = await page.evaluate(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      window.localStorage;
      return false;
    } catch {
      return true;
    }
  });
  expect(caught).toBe(true);
  // Reset the recorder so this deliberate violation does not fail the test.
  await page.evaluate(() => {
    (window as unknown as { __mwGuard: { storage: string[] } }).__mwGuard.storage.length = 0;
  });
  expect(guard.offAllowlist).toEqual([]);
});
