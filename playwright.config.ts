import { defineConfig, devices } from '@playwright/test';

// All e2e tests run against the production build (single HTML file with the
// real CSP), never the dev server.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'mocked', testIgnore: /live\// },
    {
      name: 'live',
      testMatch: /live\/.*\.spec\.ts/,
      timeout: 10 * 60_000,
      use: process.env.HTTPS_PROXY
        ? {
            proxy: { server: process.env.HTTPS_PROXY },
            // Sandboxed CI behind a TLS-intercepting proxy: trust only that CA, by SPKI pin.
            ...(process.env.PW_TRUST_SPKI
              ? { launchOptions: { args: [`--ignore-certificate-errors-spki-list=${process.env.PW_TRUST_SPKI}`] } }
              : {}),
          }
        : {},
    },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
