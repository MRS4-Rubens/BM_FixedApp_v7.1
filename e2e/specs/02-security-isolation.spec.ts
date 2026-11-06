import { test, expect } from '@playwright/test';
import * as path from 'path';
import { loadJourneyState } from '../fixtures/test';
import { loadE2eEnv } from '../support/env';

test.describe('02 - Security & Cross-Tenant Isolation', () => {
  const adminAuthFile = path.resolve(process.cwd(), 'e2e/.auth/admin.json');
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');

  test('cross-tenant isolation: another user (admin) cannot access journey invoice details', async ({
    browser,
    baseURL,
  }) => {
    const journey = loadJourneyState();
    if (!journey.invoiceId) {
      test.skip(true, 'No invoiceId present in journey state');
      return;
    }

    const targetUrl = baseURL ?? loadE2eEnv(process.env).E2E_BASE_URL;

    // Create browser context authenticated as the admin (a distinct tenant)
    const adminContext = await browser.newContext({
      storageState: adminAuthFile,
      baseURL: targetUrl,
    });
    const page = await adminContext.newPage();

    // 1. Invoice detail page for another tenant's invoice must return 404 or redirect
    const res = await page.goto(`/invoices/${journey.invoiceId}`);
    const status = res ? res.status() : 200;
    const bodyText = await page.locator('body').innerText();

    // Must be 404/redirect or show not found, and must NEVER leak the invoice number
    if (journey.invoiceNumber) {
      expect(bodyText).not.toContain(journey.invoiceNumber);
    }
    expect([404, 307, 308, 302, 200]).toContain(status);
    if (status === 200) {
      // If 200, must be the branded not-found boundary
      expect(bodyText.toLowerCase()).toContain('not found');
    }

    // 2. Archival render API without a valid signed token must return 401 or 403 or 404
    const apiRes = await adminContext.request.get(`/api/invoices/${journey.invoiceId}/archival-render`);
    expect([401, 403, 404]).toContain(apiRes.status());
    const apiBody = await apiRes.text();
    if (journey.invoiceNumber) {
      expect(apiBody).not.toContain(journey.invoiceNumber);
    }

    await adminContext.close();
  });

  test('unauthenticated access: protected routes redirect to login or return 401/403', async ({
    browser,
    baseURL,
  }) => {
    const targetUrl = baseURL ?? loadE2eEnv(process.env).E2E_BASE_URL;
    // Completely unauthenticated context (no storage state)
    const unauthContext = await browser.newContext({ baseURL: targetUrl });
    const page = await unauthContext.newPage();

    const protectedPages = ['/dashboard', '/invoices', '/admin'];
    for (const route of protectedPages) {
      await page.goto(route);
      await page.waitForURL(/\/(login|\?auth=login)/, { timeout: 10_000 });
      expect(page.url()).toMatch(/\/(login|\?auth=login)/);
    }

    // Direct API route without session returns 401/403/redirect
    const apiRes = await unauthContext.request.get('/api/reports/export?type=gstr1');
    expect([401, 403, 307, 308]).toContain(apiRes.status());

    await unauthContext.close();
  });

  test('role isolation: standard business user is forbidden from /admin', async ({
    browser,
    baseURL,
  }) => {
    const targetUrl = baseURL ?? loadE2eEnv(process.env).E2E_BASE_URL;
    // Normal user context
    const userContext = await browser.newContext({
      storageState: userAuthFile,
      baseURL: targetUrl,
    });
    const page = await userContext.newPage();

    const res = await page.goto('/admin');
    const status = res ? res.status() : 200;
    const url = page.url();

    // Must be 403 or redirected away from /admin (e.g. to /dashboard or /login)
    const isDenied = status === 403 || !url.includes('/admin') || url.includes('/dashboard');
    expect(isDenied).toBe(true);

    await userContext.close();
  });
});

