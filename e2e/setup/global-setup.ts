import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { assertSafeTarget, loadE2eEnv } from '../support/env';
import { resetAuthRateLimits } from '../support/rate-limits';
import { markEmailVerified } from '../support/db';
import { e2eExtraHttpHeaders } from '../support/http-headers';

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

  // Same headers as playwright.config.ts: skip the Vercel preview toolbar, bypass Deployment Protection.
  const extraHTTPHeaders = e2eExtraHttpHeaders(env.E2E_VERCEL_BYPASS_SECRET);

  // 3. Ensure persistent admin account
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: env.E2E_BASE_URL,
    extraHTTPHeaders,
  });
  const page = await context.newPage();

  const adminStoragePath = path.join(authDir, 'admin.json');

  // After login the app redirects to /dashboard; a user without a business (the platform admin has none) is
  // then sent on to /settings. Any of these means the session was established.
  const signedInUrl = /\/(dashboard|admin|settings)(?:[/?#]|$)/;

  const login = async (timeout: number): Promise<boolean> => {
    await page.goto('/?auth=login');
    await page.locator('#login-email').fill(env.E2E_ADMIN_EMAIL);
    await page.locator('#login-password').fill(env.E2E_ADMIN_PASSWORD);
    await page.locator('form button[type="submit"]').click();
    try {
      await page.waitForURL(signedInUrl, { timeout });
      return true;
    } catch {
      return false;
    }
  };

  try {
    const loggedIn = await login(8_000);

    if (!loggedIn) {
      // Credentials rejected, account missing, or account exists but is unverified. Signing up an existing
      // account is rejected by the auth service and is harmless; the verification step below handles both.
      console.log(`[E2E Global Setup] Admin login failed. Signing up admin (no-op if it already exists): ${env.E2E_ADMIN_EMAIL}`);
      await page.goto('/?auth=signup');
      await page.locator('#signup-owner').fill('Platform Super Admin');
      await page.locator('#signup-email').fill(env.E2E_ADMIN_EMAIL);
      await page.locator('#signup-pass').fill(env.E2E_ADMIN_PASSWORD);
      await page.locator('#signup-confirm').fill(env.E2E_ADMIN_PASSWORD);
      await page.locator('#terms').check();
      await page.locator('form button[type="submit"]').click();
      await page.waitForLoadState('networkidle');
    }

    // Platform admin access by e-mail requires a VERIFIED e-mail (lib/auth/admin-policy.ts). Make sure it is
    // verified on every run (idempotent), then sign in again so the session carries emailVerified=true.
    if (env.E2E_VERIFY_MODE === 'db') {
      await markEmailVerified(env.E2E_ADMIN_EMAIL, env);
      await context.clearCookies();
      if (!(await login(20_000))) {
        throw new Error('Admin login failed after marking the e-mail verified. Check E2E_ADMIN_PASSWORD.');
      }
    } else if (!loggedIn) {
      throw new Error(`Admin is not signed in and E2E_VERIFY_MODE=${env.E2E_VERIFY_MODE} cannot verify it automatically.`);
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

