import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { Page } from '@playwright/test';
import { test, expect } from './guard';
import { fakeNet, type FakeNetOptions } from './fakeNet';

const KEEP_TECHNIQUES = new Set(['homoglyph', 'repetition', 'dictionary', 'tld-swap']);

async function setupCase(page: Page, mock: (h: ReturnType<typeof fakeNet>) => void, net: FakeNetOptions = {}, url = '/') {
  mock(fakeNet(net));
  page.on('dialog', (d) => void d.accept());
  await page.goto(url);
  await page.getByLabel('Marks').fill('Acme');
  await page.getByLabel('Primary domain').fill('acme.com');
  await page.getByLabel('Mark owner').fill('Acme Widgets, Inc.');
  await page.getByLabel('Owned domains').fill('acme.com');
  await page.getByLabel('Authorized domains').fill('acme-partner.com, Partner Co');
  await page.getByLabel('Sender name').fill('Pat Counsel');
  await page.getByLabel('Sender title').fill('Senior Counsel');
  await page.getByLabel('Sender organization').fill('Acme Widgets, Inc.');
  await page.getByLabel('Sender email').fill('legal@acme.example');
  await page.getByLabel('Sender phone').fill('+1 555 0100');
  await page.getByLabel('Sender address').fill('1 Main St, Springfield');
  // Keep the run small: a handful of techniques still produces ~1,000 candidates.
  for (const box of await page.locator('fieldset').first().getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').innerText()).trim();
    if (KEEP_TECHNIQUES.has(label) !== (await box.isChecked())) await box.click();
  }
  await page.getByRole('button', { name: 'Save setup' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

async function discoverAndResolve(page: Page, opts: { ct?: boolean } = {}) {
  await page.getByRole('button', { name: 'Continue to discovery →' }).click();
  await page.getByLabel('Known domains').fill('acme-partner.com');
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await expect(page.getByTestId('discovery-summary')).toContainText('permutations generated');
  if (opts.ct) {
    await page.getByRole('button', { name: /Search for “acme”/ }).click();
    await expect(page.getByText('Searching…')).toBeHidden({ timeout: 60_000 });
  }
  await page.getByRole('button', { name: /Resolve [\d,]+ unresolved/ }).click();
  await expect(page.getByRole('button', { name: 'Resolve 0 unresolved domain(s)' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden({ timeout: 120_000 });
}

async function openDomain(page: Page, domain: string, filter = 'all') {
  await page.getByRole('button', { name: '3. Triage' }).click();
  await page.getByLabel('Registration filter').selectOption(filter);
  await page.getByLabel('Search domains').fill(domain);
  await page.getByTestId('triage-table').getByRole('button', { name: domain, exact: true }).click();
}

async function classify(page: Page, label: string) {
  await page.getByLabel('Classification', { exact: true }).selectOption({ label });
  await page.getByRole('button', { name: 'Save classification' }).click();
}

test.describe('Markwatch end to end (network mocked)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('setup → discover → resolve → triage → classify → route → draft → .eml export', async ({ page, mock }) => {
    await setupCase(page, mock);
    await discoverAndResolve(page);

    // Triage: the brand-new, mail-only "login" domain ranks first among registered domains.
    await page.getByRole('button', { name: '3. Triage' }).click();
    const firstRow = page.getByTestId('triage-table').locator('tbody tr').first();
    await expect(firstRow).toContainText('acme-login.com');
    // The authorized domain is excluded by default.
    await expect(page.getByTestId('triage-table')).not.toContainText('acme-partner.com');

    await openDomain(page, 'acme-login.com', 'registered');
    const items = page.getByTestId('score-items');
    await expect(items).toContainText('Registered 5 days ago');
    await expect(items).toContainText('Accepts email (MX) but has no website');
    await expect(items).toContainText('risky keyword(s): login');

    await classify(page, 'Phishing or malware');
    await expect(page.getByText('Recommended route: Report to the registrar and the host now')).toBeVisible();
    await expect(page.getByText(/abuse@registrar\.example/).first()).toBeVisible();
    await expect(page.getByText(/Source: RDAP .*registrar abuse role/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Draft: Registrar abuse report' }).click();
    const editor = page.getByTestId('draft-editor');
    await expect(editor.getByTestId('draft-preview')).toContainText('DRAFT. Attorney review required before sending.');
    const eml = editor.getByRole('button', { name: 'Download .eml' });
    await expect(eml).toBeDisabled();
    await expect(editor.getByText('Export is blocked until every unfilled field is filled or dismissed.')).toBeVisible();
    await expect(editor.getByTestId('draft-preview')).toContainText('⟦UNFILLED');

    // Fill user-input fields; dismiss anything else that is still unfilled.
    for (let guard = 0; guard < 30; guard++) {
      const field = editor.locator('[data-testid="draft-field"][data-state="unfilled"]').first();
      if ((await field.count()) === 0) break;
      const name = (await field.locator('.font-mono').innerText()).trim();
      if (name.startsWith('input.')) {
        await field.getByLabel(`Value for ${name}`).fill(`Test ${name}`);
      } else {
        await field.getByRole('button', { name: 'Leave out (dismiss)…' }).click();
        await field.getByLabel(`Dismiss reason for ${name}`).fill('Not applicable in test');
        await field.getByRole('button', { name: 'Dismiss' }).click();
      }
    }
    await expect(eml).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), eml.click()]);
    const text = readFileSync((await download.path()), 'utf8');
    expect(download.suggestedFilename()).toBe('registrar-abuse-acme-login.com.eml');
    expect(text).toContain('X-Unsent: 1');
    expect(text).toContain('To: abuse@registrar.example');
    expect(text).toMatch(/\r\n/);
    expect(text).not.toContain('⟦UNFILLED');
    await expect(editor.getByText(/Nothing was sent/)).toBeVisible();
  });

  test('a blocked RDAP lookup is shown as blocked, never as "no data", and can be filled in by hand', async ({ page, mock }) => {
    await setupCase(page, mock);
    await discoverAndResolve(page);

    // acme.shop: the registry answers 429 without CORS headers, exactly like the real GMO RDAP server did.
    await openDomain(page, 'acme.shop', 'registered');
    const blocked = page.locator('[data-testid="lookup"][data-status="blocked"]').filter({ hasText: 'rdap-domain' });
    await expect(blocked).toContainText('Blocked by the browser');
    await expect(blocked).toContainText('This is not “no data”');
    await expect(blocked).toContainText('cannot see the status code');
    await expect(blocked.getByRole('link', { name: 'Open this lookup in a new tab' })).toHaveAttribute('href', /\/domain\/acme\.shop$/);

    await blocked.getByRole('button', { name: 'Paste the result by hand' }).click();
    const pasted = JSON.stringify({
      objectClassName: 'domain',
      ldhName: 'acme.shop',
      status: ['active'],
      events: [{ eventAction: 'registration', eventDate: '2026-09-20T00:00:00Z' }],
      entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Pasted Registrar KK']]], entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@pasted.example']]] }] }],
    });
    await page.getByLabel('Paste result for acme.shop').fill(pasted);
    await page.getByRole('button', { name: 'Save as user-entered result' }).click();
    await expect(page.locator('[data-testid="lookup"][data-status="manual"]').filter({ hasText: 'rdap-domain' })).toContainText('Entered by user');
    await expect(page.getByText('Pasted Registrar KK').first()).toBeVisible();

    // acme.io: no RDAP service in the IANA bootstrap — labelled as such, with a registry link.
    await openDomain(page, 'acme.io', 'registered');
    const unsupported = page.locator('[data-testid="lookup"][data-status="blocked"]').filter({ hasText: 'rdap-domain' });
    await expect(unsupported).toContainText('No lookup service');
    await expect(unsupported.getByRole('link', { name: 'Open this lookup in a new tab' })).toBeVisible();
  });

  test('certificate transparency: results add domains; a crt.sh failure is shown as blocked with a paste box', async ({ page, mock }) => {
    await setupCase(page, mock, { crtsh: 'blocked' });
    await page.getByRole('button', { name: 'Continue to discovery →' }).click();
    await page.getByRole('button', { name: 'Generate candidates' }).click();
    await page.getByRole('button', { name: /Search for “acme”/ }).click();
    await expect(page.getByText('Searching…')).toBeHidden({ timeout: 90_000 });
    const ct = page.locator('[data-testid="lookup"][data-status="blocked"]').filter({ hasText: 'ct' });
    await expect(ct).toHaveCount(2);
    await expect(ct.first()).toContainText('Blocked by the browser');
    await expect(page.getByText(/0 certificate/)).toHaveCount(0);

    await ct.first().getByRole('button', { name: 'Paste the result by hand' }).click();
    await page.getByLabel(/Paste result for acme% /).fill(
      JSON.stringify([{ id: 777, issuer_name: 'C=US, O=Test CA', common_name: 'acme-secure-pay.com', name_value: 'acme-secure-pay.com', not_before: '2026-10-01T00:00:00', not_after: '2026-12-30T00:00:00' }]),
    );
    await page.getByRole('button', { name: 'Save as user-entered result' }).click();
    await expect(page.locator('[data-testid="lookup"][data-status="manual"]')).toContainText('1 certificate');
    await page.getByRole('button', { name: '3. Triage' }).click();
    await page.getByLabel('Registration filter').selectOption('all');
    await page.getByLabel('Search domains').fill('acme-secure-pay');
    await expect(page.getByTestId('triage-table')).toContainText('acme-secure-pay.com');
  });

  test('fair use locks outbound templates until counsel review is recorded; authorized parties only get a compliance note', async ({ page, mock }) => {
    await setupCase(page, mock);
    await discoverAndResolve(page);

    await openDomain(page, 'acrne.com', 'registered');
    await classify(page, 'Possible fair use or criticism');
    await expect(page.getByRole('alert').filter({ hasText: 'Possible fair use or criticism' })).toBeVisible();
    const locked = page.getByRole('button', { name: /🔒 Letter to the registrant/ });
    await expect(locked).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Record acknowledgment' })).toBeDisabled();
    await page.getByLabel('Acknowledged by').fill('Jordan Counsel');
    await page.getByRole('button', { name: 'Record acknowledgment' }).click();
    await expect(page.getByText(/confirmed by Jordan Counsel/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Draft: Letter to the registrant/ })).toBeEnabled();

    await page.getByRole('button', { name: '3. Triage' }).click();
    await page.getByLabel('Show owned / authorized').check();
    await openDomain(page, 'acme-partner.com');
    await classify(page, 'Authorized but noncompliant');
    const drafts = page.getByRole('button', { name: /^Draft: / });
    await expect(drafts).toHaveCount(1);
    await expect(drafts.first()).toHaveText(/compliance note/i);
  });

  test('DMCA route states that the DMCA covers copyright, not trademark', async ({ page, mock }) => {
    await setupCase(page, mock);
    await discoverAndResolve(page);
    await openDomain(page, 'acrne.com', 'registered');
    await classify(page, 'Copied content');
    const banner = page.getByRole('alert').filter({ hasText: 'The DMCA covers copyright, not trademark.' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  });

  test('case file: export, reload (memory is wiped), import restores state and verifies the audit chain', async ({ page, mock }) => {
    await setupCase(page, mock);
    await discoverAndResolve(page);
    await openDomain(page, 'acme-login.com', 'registered');
    await classify(page, 'Phishing or malware');
    await page.getByLabel('Attach evidence').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from('fake png bytes') });
    await expect(page.getByText('SHA-256 ').first()).toBeVisible();

    await page.getByRole('button', { name: 'Case file & audit log' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export case file (.zip)' }).click()]);
    const zipPath = (await download.path());
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['case.json', 'manifest.json', 'README.txt']));
    const caseJson = JSON.parse(strFromU8(files['case.json']!)) as { schemaVersion: number; case: { domains: unknown[]; audit: { type: string }[] } };
    expect(caseJson.schemaVersion).toBe(1);
    expect(caseJson.case.audit.some((a) => a.type === 'lookup')).toBe(true);
    expect(caseJson.case.audit.some((a) => a.type === 'classification.set')).toBe(true);
    const evidenceName = Object.keys(files).find((f) => f.startsWith('evidence/'));
    expect(evidenceName).toMatch(/^evidence\/[0-9a-f]{64}-screenshot\.png$/);
    const domainCount = caseJson.case.domains.length;

    // Reload: nothing survives in the browser.
    await page.reload();
    await expect(page.getByText('0 domains in case')).toBeVisible();

    await page.getByRole('button', { name: 'Case file & audit log' }).click();
    await page.getByLabel('Import case file').setInputFiles(path.resolve(zipPath));
    await expect(page.getByText(/Audit log hash chain verified: the log is internally consistent/)).toBeVisible();
    await expect(page.getByText(`${domainCount} domains in case`)).toBeVisible();
    await openDomain(page, 'acme-login.com', 'registered');
    await expect(page.getByText('Recommended route: Report to the registrar and the host now')).toBeVisible();
    await expect(page.getByText('screenshot.png')).toBeVisible();
  });

  test('About page states that the tool does not give legal advice and lists the allowlist', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'About & privacy' }).click();
    await expect(page.getByTestId('about-legal')).toContainText('Markwatch does not give legal advice.');
    await expect(page.getByText('cloudflare-dns.com', { exact: true })).toBeVisible();
  });
});

test.describe('opened from disk (file://)', () => {
  test.describe.configure({ timeout: 240_000 });
  test('the single-file build runs from file:// under its CSP, including lookups', async ({ page, mock }) => {
    const fileUrl = `file://${path.resolve('dist/index.html')}`;
    await setupCase(page, mock, {}, fileUrl);
    await discoverAndResolve(page);
    await page.getByRole('button', { name: '3. Triage' }).click();
    await expect(page.getByTestId('triage-table').locator('tbody tr').first()).toContainText('acme-login.com');
  });
});
