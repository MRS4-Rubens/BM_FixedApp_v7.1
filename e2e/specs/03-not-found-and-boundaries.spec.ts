import { test, expect } from '../fixtures/test';
import * as path from 'path';
import * as fs from 'fs';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp } from '../support/navigation';

test.describe('03 - Not Found and Route Boundaries', () => {
  test('unmatched route shows branded 404 with navigation links', async ({ page }) => {
    const response = await gotoApp(page, '/definitely-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
  });

  test('nonexistent entity ID inside authenticated shell shows 404 within app shell', async ({ page }) => {
    const userStatePath = path.resolve(process.cwd(), 'e2e/.auth/user.json');
    if (!fs.existsSync(userStatePath)) {
      test.skip(true, 'e2e/.auth/user.json not found; requires journey spec to create user session');
      return;
    }

    const browser = page.context().browser();
    if (!browser) {
      test.skip(true, 'Browser context unavailable');
      return;
    }

    const authContext = await browser.newContext({
      extraHTTPHeaders: e2eExtraHttpHeaders(),
      storageState: userStatePath,
      baseURL: process.env.E2E_BASE_URL,
    });

    try {
      const authPage = await authContext.newPage();
      const response = await gotoApp(authPage, '/customers/00000000-0000-0000-0000-000000000000/edit');
      // This route has a loading.tsx boundary, so Next.js streams the response: headers (status 200) are sent
      // before the page calls notFound(). Next then renders the not-found UI and injects a robots noindex tag.
      // Accept either status, but a 200 must carry noindex so the page is never indexed.
      expect([200, 404]).toContain(response?.status());
      if (response?.status() === 200) {
        await expect(authPage.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
      }
      // App shell sidebar / navigation must be visible
      await expect(authPage.getByRole('navigation')).toBeVisible();
      // Branded 404 heading inside shell
      await expect(authPage.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
    } finally {
      await authContext.close();
    }
  });

  test('development boundary test route returns 404 on preview/production', async ({ page }) => {
    const response = await gotoApp(page, '/dev-boundary-test');
    if (process.env.NODE_ENV === 'production' || response?.status() === 404) {
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
    } else {
      expect([200, 404]).toContain(response?.status());
    }
  });
});

