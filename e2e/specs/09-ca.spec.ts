import { test, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import { loadE2eEnv } from '../support/env';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp, waitForAppUrl } from '../support/navigation';
import { markEmailVerified } from '../support/db';
import { generateRunId, generateTestPassword } from '../support/identity';
import { resetAuthRateLimits } from '../support/rate-limits';
import { loadJourneyState } from '../fixtures/test';
import { AuthModal } from '../pages/AuthModal';
import { AdminPage } from '../pages/AdminPage';
import { TeamSettingsPage } from '../pages/TeamSettingsPage';

test.describe.configure({ mode: 'serial' });

/**
 * Feature B (read-only accountant / CA):
 * 1. Owner on Essentials plan sees Accountant radio disabled with Professional plan badge.
 * 2. Admin upgrades business to Professional plan via manual override.
 * 3. Owner invites accountant; invite shows accountant link and copy.
 * 4. Accountant signs up, joins business, and sees read-only experience everywhere:
 *    - No create/edit buttons on Dashboard, Invoices, Customers, Products
 *    - Direct URL access to /new routes redirects to matching list views
 *    - Invoice detail hides share/remind/credit-note and payment recording
 *    - Settings displays read-only banner and Accountant role badge
 * 5. Owner switches the CA to Team member and back (enforced on the next page load), then removes them.
 * 6. Admin restores the plan to Essentials in a finally block.
 */
test.describe('09 - Accountant (CA) Read-Only Collaboration Journey', () => {
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');
  const adminAuthFile = path.resolve(process.cwd(), 'e2e/.auth/admin.json');

  test('owner upgrades to professional, invites CA, verifies read-only boundaries, cleans up', async ({ browser }) => {
    const env = loadE2eEnv(process.env);
    await resetAuthRateLimits(env);

    const journeyState = loadJourneyState();
    const businessName = journeyState.businessName;

    const runId = generateRunId();
    const caEmail = `e2e+${runId}-ca@example.test`;
    const caPassword = generateTestPassword();
    const caName = `CA ${runId.slice(-6)}`;

    let ownerContext: BrowserContext | null = null;
    let adminContext: BrowserContext | null = null;
    let caContext: BrowserContext | null = null;

    let adminPageObj: AdminPage | null = null;
    let teamSettings: TeamSettingsPage | null = null;

    try {
      // ── Step 1: Owner sees Accountant radio disabled on Essentials ───────────
      ownerContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: userAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const ownerPage = await ownerContext.newPage();
      teamSettings = new TeamSettingsPage(ownerPage);
      await teamSettings.goto();

      await expect(teamSettings.accountantRoleRadio).toBeDisabled({ timeout: 15_000 });
      await expect(ownerPage.getByText('Professional plan', { exact: true }).first()).toBeVisible();

      // ── Step 2: Admin upgrades business to Professional ───────────────────────
      adminContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: adminAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const adminPage = await adminContext.newPage();
      adminPageObj = new AdminPage(adminPage);
      await adminPageObj.goto();
      await adminPageObj.setBusinessPlan(businessName, 'professional');

      // ── Step 3: Owner invites accountant on Professional plan ─────────────────
      await teamSettings.goto();
      await expect(teamSettings.accountantRoleRadio).toBeEnabled({ timeout: 15_000 });

      const inviteUrl = await teamSettings.sendInvite(caEmail, 'accountant');
      expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
      const invitePath = new URL(inviteUrl).pathname;

      // ── Step 4: CA registers and joins business ───────────────────────────────
      caContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        baseURL: env.E2E_BASE_URL,
      });
      const caPage = await caContext.newPage();
      const authModal = new AuthModal(caPage);

      await gotoApp(caPage, invitePath);
      await expect(caPage.getByRole('heading', { name: /^Join / })).toBeVisible({ timeout: 15_000 });
      await caPage.getByRole('link', { name: 'Create an account' }).click();
      await expect(authModal.modalDialog).toBeVisible({ timeout: 15_000 });
      await authModal.fillSignup({ ownerName: caName, email: caEmail, password: caPassword });
      await authModal.submitSignup();

      if (env.E2E_EXPECT_VERIFICATION_REQUIRED) {
        await authModal.expectVerificationNotice();
        if (env.E2E_VERIFY_MODE === 'db') {
          await markEmailVerified(caEmail, env);
        }
        await authModal.openLogin();
        await authModal.fillLogin(caEmail, caPassword);
        await authModal.submitLogin();
      }

      await waitForAppUrl(caPage, /\/invite\/[A-Za-z0-9_-]{43}/, 30_000);
      await caPage.getByRole('button', { name: /^Join / }).click();
      await waitForAppUrl(caPage, /\/dashboard/, 30_000);

      // ── Step 5: Verify CA read-only boundary across app ───────────────────────
      // 5a. Dashboard
      await expect(caPage.getByRole('link', { name: 'New Invoice' })).toHaveCount(0);
      await expect(caPage.getByRole('link', { name: 'Add Customer' })).toHaveCount(0);
      await expect(caPage.getByRole('link', { name: 'Add Product' })).toHaveCount(0);

      // 5b. Invoices list
      await gotoApp(caPage, '/invoices');
      await waitForAppUrl(caPage, /\/invoices/, 20_000);
      await expect(caPage.getByRole('link', { name: 'New Invoice' })).toHaveCount(0);

      // 5c. Customers list
      await gotoApp(caPage, '/customers');
      await waitForAppUrl(caPage, /\/customers/, 20_000);
      await expect(caPage.getByRole('link', { name: 'Add Customer' })).toHaveCount(0);
      await expect(caPage.getByRole('link', { name: 'Edit' })).toHaveCount(0);

      // 5d. Products list
      await gotoApp(caPage, '/products');
      await waitForAppUrl(caPage, /\/products/, 20_000);
      await expect(caPage.getByRole('link', { name: 'Add Product' })).toHaveCount(0);
      await expect(caPage.getByRole('link', { name: 'Edit' })).toHaveCount(0);

      // 5e. Direct access to write pages is blocked and redirected
      await gotoApp(caPage, '/invoices/new');
      await waitForAppUrl(caPage, /\/invoices(?!\/new)/, 20_000);

      await gotoApp(caPage, '/customers/new');
      await waitForAppUrl(caPage, /\/customers(?!\/new)/, 20_000);

      await gotoApp(caPage, '/products/new');
      await waitForAppUrl(caPage, /\/products(?!\/new)/, 20_000);

      // 5f. Invoice detail page read-only verification
      if (journeyState.invoiceId) {
        await gotoApp(caPage, `/invoices/${journeyState.invoiceId}`);
        await waitForAppUrl(caPage, new RegExp(`/invoices/${journeyState.invoiceId}`), 20_000);
        // Positive control first: the page really rendered the action bar (print stays available to the CA).
        await expect(caPage.getByTitle('Print Invoice (System Dialog)')).toBeVisible({ timeout: 15_000 });
        // Labels below are the real button texts in components/app/invoices/invoice-detail.tsx / payment-section.tsx.
        await expect(caPage.getByRole('button', { name: 'WhatsApp', exact: true })).toHaveCount(0);
        await expect(caPage.getByRole('button', { name: 'Email', exact: true })).toHaveCount(0);
        await expect(caPage.getByRole('button', { name: 'Reminder', exact: true })).toHaveCount(0);
        await expect(caPage.getByRole('heading', { name: /^Record (Payment|Refund)$/i })).toHaveCount(0);
        await expect(caPage.getByRole('link', { name: /Issue Credit Note/i })).toHaveCount(0);
      }

      // 5g. Settings read-only verification
      await gotoApp(caPage, '/settings');
      await waitForAppUrl(caPage, /\/settings/, 20_000);
      await expect(caPage.getByText('Only the business owner can change these details.')).toBeVisible({ timeout: 15_000 });
      await expect(caPage.locator('input[name="legal_name"]')).toBeDisabled();
      for (const hiddenTab of ['Users & Roles', 'Billing & Usage', 'General']) {
        await expect(caPage.getByRole('button', { name: hiddenTab, exact: true })).toHaveCount(0);
      }
      await expect(caPage.getByText('Accountant (read-only)', { exact: true }).first()).toBeAttached();

      // ── Step 6: Change role: Accountant -> Team member -> Accountant, enforced on the next page load ─
      await teamSettings.goto();
      await teamSettings.changeMemberRole(caEmail, 'staff');
      // As a team member the person may create invoices: the form stays (no redirect to the list).
      await gotoApp(caPage, '/invoices/new');
      await caPage.waitForLoadState('networkidle');
      await expect(caPage).toHaveURL(/\/invoices\/new$/, { timeout: 20_000 });
      await expect(caPage.getByText('Team member', { exact: true }).first()).toBeAttached();

      await teamSettings.goto();
      await teamSettings.changeMemberRole(caEmail, 'accountant');
      await gotoApp(caPage, '/invoices/new');
      await waitForAppUrl(caPage, /\/invoices$/, 20_000);

      // ── Step 7: Owner removes the CA (asserted, not just best-effort cleanup) ─
      await teamSettings.goto();
      await teamSettings.removeMember(caEmail);
      await teamSettings.expectMemberNotVisible(caEmail);
    } finally {
      // ── Cleanup (always) ────────────────────────────────────────────────────
      // 6a. Downgrade business back to Essentials
      try {
        if (adminPageObj) {
          await adminPageObj.goto();
          await adminPageObj.setBusinessPlan(businessName, 'essentials');
        }
      } catch (err) {
        console.error('Failed to restore business plan to essentials in E2E cleanup:', err);
      }

      // 6b. Owner removes the CA if an earlier step failed before Step 7
      try {
        if (teamSettings) {
          await teamSettings.goto();
          const hasCaRow = await teamSettings.page.locator('tr').filter({ hasText: caEmail }).count();
          if (hasCaRow > 0) {
            await teamSettings.removeMember(caEmail);
          }
        }
      } catch (err) {
        console.error('Failed to remove CA member in E2E cleanup:', err);
      }

      // 6c. Close contexts
      await caContext?.close();
      await adminContext?.close();
      await ownerContext?.close();
    }
  });
});
