// Opt-in live test: real lookups for example.com in a real browser, through
// the production build and its CSP. Run with `npm run test:live`.
// It proves the endpoints answer cross-origin from a browser (a terminal fetch
// proves nothing about CORS) and that the app wires them up correctly.
import { test, expect } from '../guard';

test.use({ live: true });
test.skip(!process.env.MARKWATCH_LIVE, 'Set MARKWATCH_LIVE=1 to run live lookups.');

test('live: example.com resolves via DoH, registry RDAP and RIR RDAP from the browser', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByLabel('Marks').fill('Example');
  // Primary domain example.net makes example.com a tld-swap candidate.
  await page.getByLabel('Primary domain').fill('example.net');
  await page.getByLabel('Mark owner').fill('Example Owner');
  await page.getByLabel('Owned domains').fill('example.net');
  for (const box of await page.locator('fieldset').first().getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').innerText()).trim();
    if ((label === 'tld-swap') !== (await box.isChecked())) await box.click();
  }
  await page.getByLabel('TLDs').fill('com');
  await page.getByRole('button', { name: 'Save setup' }).click();
  await page.getByRole('button', { name: 'Continue to discovery →' }).click();
  await page.getByRole('button', { name: 'Generate candidates' }).click();
  await page.getByRole('button', { name: /Resolve [\d,]+ unresolved/ }).click();
  await expect(page.getByRole('button', { name: 'Resolve 0 unresolved domain(s)' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden({ timeout: 300_000 });

  await page.getByRole('button', { name: '3. Triage' }).click();
  await page.getByLabel('Search domains').fill('example.com');
  await page.getByTestId('triage-table').getByRole('button', { name: 'example.com', exact: true }).click();

  const lookups = page.getByTestId('lookup');
  // DNS and registry RDAP answered.
  await expect(lookups.filter({ hasText: 'example.com NS' }).first()).toHaveAttribute('data-status', 'ok');
  await expect(lookups.filter({ hasText: 'rdap-domain' }).first()).toHaveAttribute('data-status', 'ok');
  await expect(page.getByText('rdap.verisign.com').first()).toBeVisible();
  // IANA holds example.com.
  await expect(page.getByText(/Internet Assigned Numbers Authority/i).first()).toBeVisible();
  // Every IP got a network answer (RIR RDAP), never a silent empty.
  const ipLookups = lookups.filter({ hasText: 'rdap-ip' });
  expect(await ipLookups.count()).toBeGreaterThan(0);
  for (const l of await ipLookups.all()) expect(['ok', 'not_found']).toContain(await l.getAttribute('data-status'));
});
