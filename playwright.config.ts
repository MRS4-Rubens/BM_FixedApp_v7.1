import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

const extraHTTPHeaders: Record<string, string> = {};
if (process.env.E2E_VERCEL_BYPASS_SECRET) {
  extraHTTPHeaders['x-vercel-protection-bypass'] = process.env.E2E_VERCEL_BYPASS_SECRET;
  extraHTTPHeaders['x-vercel-set-bypass-cookie'] = 'true';
}

const reporters: Array<[string] | [string, Record<string, unknown>]> = [
  ['list'],
  ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ['junit', { outputFile: 'test-results/junit.xml' }],
];

if (process.env.CI) {
  reporters.push(['github']);
}

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/setup/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  reporter: reporters,
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders,
  },
  projects: [
    {
      name: 'journey',
      testMatch: [
        '01-journey.spec.ts',
        '02-security-isolation.spec.ts',
        '03-not-found-and-boundaries.spec.ts',
      ],
      retries: 0, // Journey runs serially with fresh user; retrying burns the 3/hr signup rate limit
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'mobile',
      testMatch: '04-mobile-smoke.spec.ts',
      dependencies: ['journey'],
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        trace: 'on-first-retry',
      },
    },
    {
      name: 'quality',
      testMatch: ['05-a11y.spec.ts', '06-print-layout.spec.ts'],
      dependencies: ['journey'],
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        trace: 'on-first-retry',
      },
    },
    {
      name: 'mailbox',
      testMatch: '07-mailbox-verification.spec.ts',
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        trace: 'on-first-retry',
      },
    },
  ],
});

