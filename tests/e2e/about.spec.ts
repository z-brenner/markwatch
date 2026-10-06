import type { Page, Route } from '@playwright/test';
import bundled from '../../src/data/rdap-bootstrap.json' with { type: 'json' };
import { test, expect } from './guard';

type Service = [string[], string[]];

/** IANA's dns.json, rebuilt from the bundled snapshot, optionally edited. */
function ianaDnsJson(edit: (s: Service[]) => Service[] = (s) => s): string {
  const services = structuredClone(bundled.dns.services) as Service[];
  return JSON.stringify({ description: 'RDAP bootstrap file for Domain Name System registrations', publication: '2026-10-06T12:00:00Z', services: edit(services), version: '1.0' });
}

async function openAbout(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'About & privacy' }).click();
}

function mockIana(mock: (h: (url: URL, route: Route) => Promise<boolean>) => void, body: string, hits: string[]) {
  mock(async (url, route) => {
    if (url.hostname === 'data.iana.org') {
      hits.push(url.href);
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body });
      return true;
    }
    return false;
  });
}

test.describe('About page', () => {
  test('ships the license texts: dnstwist Apache-2.0, the PSL MPL-2.0 notice and React MIT', async ({ page }) => {
    await openAbout(page);
    const licenses = page.getByTestId('about-licenses');
    await expect(licenses).toBeVisible();

    const dnstwist = page.getByTestId('license-dnstwist');
    await dnstwist.locator('summary').click();
    await expect(dnstwist).toContainText('Apache License');
    await expect(dnstwist).toContainText('Version 2.0, January 2004');
    await expect(dnstwist).toContainText('Marcin Ulikowski');

    const psl = page.getByTestId('license-public-suffix-list');
    await psl.locator('summary').click();
    await expect(psl).toContainText('Mozilla Public License, v. 2.0');
    await expect(psl).toContainText('https://www.mozilla.org/MPL/2.0/');
    await expect(psl).toContainText('https://publicsuffix.org/list/');

    const react = page.getByTestId('license-npm:react');
    await react.locator('summary').click();
    await expect(react).toContainText('MIT License');
    await expect(react).toContainText('Copyright (c) Meta Platforms, Inc. and affiliates.');
    await expect(react).toContainText('Permission is hereby granted, free of charge');

    await expect(page.getByTestId('license-ail-typo-squatting')).toContainText('BSD 2-Clause License');
    await expect(page.getByTestId('license-notice')).toContainText('Bundled third-party software');
  });

  test('the registry-list card shows the bundled publication date and makes no request until asked', async ({ page, guard }) => {
    await openAbout(page);
    await expect(page.getByTestId('bootstrap-publication')).toHaveText(bundled.dns.publication.slice(0, 10));
    await expect(page.getByRole('button', { name: 'Check IANA for updates' })).toBeVisible();
    expect(guard.requests.filter((r) => r.includes('data.iana.org'))).toEqual([]);
  });

  test('"Check IANA for updates" reports an up-to-date snapshot', async ({ page, mock }) => {
    const hits: string[] = [];
    mockIana(mock, ianaDnsJson(), hits);
    await openAbout(page);
    expect(hits).toEqual([]);
    await page.getByRole('button', { name: 'Check IANA for updates' }).click();
    const result = page.getByTestId('drift-result');
    await expect(result).toContainText('Up to date.');
    await expect(result).toContainText('2026-10-06');
    expect(hits).toEqual(['https://data.iana.org/rdap/dns.json']);
  });

  test('"Check IANA for updates" lists RDAP servers the build cannot contact', async ({ page, mock }) => {
    const hits: string[] = [];
    mockIana(mock, ianaDnsJson((s) => [...s, [['newtld'], ['https://rdap.new-registry.example/']]]), hits);
    await openAbout(page);
    await page.getByRole('button', { name: 'Check IANA for updates' }).click();
    const result = page.getByTestId('drift-result');
    await expect(result).toContainText('Update available.');
    await expect(result).toContainText('rdap.new-registry.example');
    await expect(result).toContainText('npm run update-bootstrap');
  });

  test('a failed check says so instead of claiming the snapshot is current', async ({ page }) => {
    // Unmocked: the guard's router refuses the connection.
    await openAbout(page);
    await page.getByRole('button', { name: 'Check IANA for updates' }).click();
    const result = page.getByTestId('drift-result');
    await expect(result).toContainText('Could not check IANA');
    await expect(result).not.toContainText('Up to date');
  });
});

test('the guard traps history, Web Locks, file pickers and non-fetch network channels', async ({ page }) => {
  await page.goto('/');
  const caught = await page.evaluate(() => {
    const attempts: [string, () => unknown][] = [
      ['pushState', () => history.pushState(null, '', '#x')],
      ['replaceState', () => history.replaceState(null, '', '#x')],
      ['locks', () => navigator.locks],
      ['showSaveFilePicker', () => (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker],
      ['RTCPeerConnection', () => new RTCPeerConnection()],
      ['WebSocket', () => new WebSocket('wss://example.invalid/')],
      ['EventSource', () => new EventSource('https://example.invalid/')],
    ];
    return attempts.filter(([, f]) => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    }).map(([n]) => n);
  });
  expect(caught).toEqual(['pushState', 'replaceState', 'locks', 'showSaveFilePicker', 'RTCPeerConnection', 'WebSocket', 'EventSource']);
  // Reset the recorder so these deliberate calls do not fail the test.
  await page.evaluate(() => {
    (window as unknown as { __mwGuard: { storage: string[] } }).__mwGuard.storage.length = 0;
  });
});
