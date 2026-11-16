import { test, expect } from '@playwright/test';
import * as path from 'path';
import { loadE2eEnv } from '../support/env';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp, waitForAppUrl } from '../support/navigation';
import { markEmailVerified } from '../support/db';
import { generateRunId, generateTestPassword } from '../support/identity';
import { resetAuthRateLimits } from '../support/rate-limits';
import { AuthModal } from '../pages/AuthModal';
import { TeamSettingsPage } from '../pages/TeamSettingsPage';

test.describe.configure({ mode: 'serial' });

/**
 * Feature A (team members): the journey owner (Essentials, 3 seats after 01-journey) invites a brand-new person,
 * who signs up through the invite link, joins as staff, sees the staff view, and loses access when removed.
 */
test.describe('08 - Team Collaboration & Staff Role Boundary', () => {
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');

  test('owner invites staff, staff joins, verifies staff permissions, owner removes staff', async ({ browser }) => {
    const env = loadE2eEnv(process.env);
    // One extra sign-up in this run: free the auth limiter first (guarded: only when E2E_UPSTASH_ALLOW_FLUSH=true).
    await resetAuthRateLimits(env);

    const runId = generateRunId();
    const staffEmail = `e2e+${runId}-staff@example.test`;
    const staffPassword = generateTestPassword();
    const staffName = `Staff ${runId.slice(-6)}`;

    // ── 1. Owner: invite ──────────────────────────────────────────────────────
    const ownerContext = await browser.newContext({
      extraHTTPHeaders: e2eExtraHttpHeaders(),
      storageState: userAuthFile,
      baseURL: env.E2E_BASE_URL,
    });
    const ownerPage = await ownerContext.newPage();
    const teamSettings = new TeamSettingsPage(ownerPage);
    await teamSettings.goto();
    const inviteUrl = await teamSettings.sendInvite(staffEmail);
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const invitePath = new URL(inviteUrl).pathname;

    // ── 2. New person: open link, sign up, (verify), join ────────────────────
    const staffContext = await browser.newContext({
      extraHTTPHeaders: e2eExtraHttpHeaders(),
      baseURL: env.E2E_BASE_URL,
    });
    const staffPage = await staffContext.newPage();
    const authModal = new AuthModal(staffPage);

    await gotoApp(staffPage, invitePath);
    await expect(staffPage.getByRole('heading', { name: /^Join / })).toBeVisible({ timeout: 15_000 });
    await staffPage.getByRole('link', { name: 'Create an account' }).click();
    await expect(authModal.modalDialog).toBeVisible({ timeout: 15_000 });
    await authModal.fillSignup({ ownerName: staffName, email: staffEmail, password: staffPassword });
    await authModal.submitSignup();

    if (env.E2E_EXPECT_VERIFICATION_REQUIRED) {
      await authModal.expectVerificationNotice();
      if (env.E2E_VERIFY_MODE === 'db') {
        await markEmailVerified(staffEmail, env);
      }
      await authModal.openLogin();
      await authModal.fillLogin(staffEmail, staffPassword);
      await authModal.submitLogin();
    }

    // Login / sign-up must return to the remembered invite, not the dashboard.
    await waitForAppUrl(staffPage, /\/invite\/[A-Za-z0-9_-]{43}/, 30_000);
    await staffPage.getByRole('button', { name: /^Join / }).click();
    await waitForAppUrl(staffPage, /\/dashboard/, 30_000);

    // ── 3. Staff view ────────────────────────────────────────────────────────
    await gotoApp(staffPage, '/settings');
    await waitForAppUrl(staffPage, /\/settings/, 20_000);
    await expect(staffPage.getByText('Only the business owner can change these details.')).toBeVisible({ timeout: 15_000 });
    await expect(staffPage.locator('input[name="legal_name"]')).toBeDisabled();
    for (const hiddenTab of ['Users & Roles', 'Billing & Usage', 'General']) {
      await expect(staffPage.getByRole('button', { name: hiddenTab, exact: true })).toHaveCount(0);
    }
    await expect(staffPage.getByText('Team member', { exact: true }).first()).toBeAttached();

    // A staff member cannot open the owner-only checkout either.
    await gotoApp(staffPage, '/checkout');
    await waitForAppUrl(staffPage, /\/dashboard/, 20_000);

    // ── 4. Owner: the member is listed, then removed ─────────────────────────
    await teamSettings.goto();
    await teamSettings.expectMemberVisible(staffEmail);
    await teamSettings.removeMember(staffEmail);
    await teamSettings.expectMemberNotVisible(staffEmail);

    // ── 5. Removed person: no business any more -> /dashboard sends them to business setup ─
    await gotoApp(staffPage, '/dashboard');
    await waitForAppUrl(staffPage, /\/settings/, 20_000);
    await expect(staffPage.locator('input[name="legal_name"]')).toBeEnabled({ timeout: 15_000 });

    await staffContext.close();
    await ownerContext.close();
  });
});
