import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { assertSafeTarget, loadE2eEnv } from '../support/env';
import { resetAuthRateLimits } from '../support/rate-limits';
import { markEmailVerified } from '../support/db';

export default async function globalSetup(): Promise<void> {
  const env = loadE2eEnv(process.env);
  assertSafeTarget(env);

  // 1. Reset rate limits if explicitly allowed
  await resetAuthRateLimits(env);

  // 2. Prepare auth storage directory
  const authDir = path.resolve(process.cwd(), 'e2e/.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const extraHTTPHeaders: Record<string, string> = {};
  if (env.E2E_VERCEL_BYPASS_SECRET) {
    extraHTTPHeaders['x-vercel-protection-bypass'] = env.E2E_VERCEL_BYPASS_SECRET;
    extraHTTPHeaders['x-vercel-set-bypass-cookie'] = 'true';
  }

  // 3. Ensure persistent admin account
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: env.E2E_BASE_URL,
    extraHTTPHeaders,
  });
  const page = await context.newPage();

  const adminStoragePath = path.join(authDir, 'admin.json');

  try {
    await page.goto('/?auth=login');
    await page.locator('#login-email').fill(env.E2E_ADMIN_EMAIL);
    await page.locator('#login-password').fill(env.E2E_ADMIN_PASSWORD);
    await page.locator('form button[type="submit"]').click();

    // Check if login succeeded (redirect to /dashboard or /admin)
    let loggedIn = false;
    try {
      await page.waitForURL(/\/(dashboard|admin)/, { timeout: 8_000 });
      loggedIn = true;
    } catch {
      loggedIn = false;
    }

    if (!loggedIn) {
      // Credentials rejected or account does not exist -> sign up ONCE
      console.log(`[E2E Global Setup] Admin account not found or credentials rejected. Signing up admin: ${env.E2E_ADMIN_EMAIL}`);
      await page.goto('/?auth=signup');
      await page.locator('#signup-owner').fill('Platform Super Admin');
      await page.locator('#signup-email').fill(env.E2E_ADMIN_EMAIL);
      await page.locator('#signup-pass').fill(env.E2E_ADMIN_PASSWORD);
      await page.locator('#signup-confirm').fill(env.E2E_ADMIN_PASSWORD);
      await page.locator('#terms').check();
      await page.locator('form button[type="submit"]').click();

      if (env.E2E_EXPECT_VERIFICATION_REQUIRED) {
        if (env.E2E_VERIFY_MODE === 'db') {
          await markEmailVerified(env.E2E_ADMIN_EMAIL, env);
        }
        // Log in after verification
        await page.goto('/?auth=login');
        await page.locator('#login-email').fill(env.E2E_ADMIN_EMAIL);
        await page.locator('#login-password').fill(env.E2E_ADMIN_PASSWORD);
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15_000 });
      }
    }

    // Verify /admin accessibility
    const adminResponse = await page.goto('/admin');
    const adminStatus = adminResponse ? adminResponse.status() : 200;
    const currentUrl = page.url();

    if (adminStatus === 403 || !currentUrl.includes('/admin')) {
      throw new Error(
        `Admin account logged in successfully, but access to /admin was forbidden (HTTP ${adminStatus}, URL: ${currentUrl}). Action required: add the admin email (${env.E2E_ADMIN_EMAIL}) to PLATFORM_ADMIN_EMAILS in the Vercel Preview environment variables and redeploy.`,
      );
    }

    // Save admin storage state for subsequent specs
    await context.storageState({ path: adminStoragePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

