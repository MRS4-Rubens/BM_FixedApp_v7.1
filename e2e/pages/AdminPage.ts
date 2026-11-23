import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp, reloadApp } from '../support/navigation';

export class AdminPage {
  readonly page: Page;

  readonly adminConsoleHeading: Locator;
  readonly pendingRequestsTable: Locator;

  constructor(page: Page) {
    this.page = page;

    this.adminConsoleHeading = page.locator('h1, h2').filter({ hasText: /Admin/i }).first();
    this.pendingRequestsTable = page.locator('table, div').filter({ hasText: /Payment Verification Queue|Manual Claims/i }).first();
  }

  async goto(): Promise<void> {
    await gotoApp(this.page, '/admin');
    await expect(this.adminConsoleHeading).toBeVisible({ timeout: 15_000 });
  }

  /** Claims are approved from the "Pending Claims" tab (the Overview tab no longer has a queue). */
  private async openPendingClaimsTab(): Promise<void> {
    // The tab's accessible name includes its count badge, e.g. "Pending Claims 1".
    await this.page.getByRole('button', { name: /^Pending Claims/ }).click();
    await expect(this.page.getByRole('heading', { name: /Pending Subscription Claims/ })).toBeVisible({ timeout: 15_000 });
  }

  /** The innermost element that contains both this UTR and an "Approve Claim" button: exactly this claim's card. */
  private claimRow(utr: string): Locator {
    const approve = this.page.getByRole('button', { name: 'Approve Claim', exact: true });
    return this.page.locator('div').filter({ hasText: utr }).filter({ has: approve }).last();
  }

  async approveClaimByUtr(utr: string): Promise<void> {
    await this.openPendingClaimsTab();
    const row = this.claimRow(utr);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const approveBtn = row.getByRole('button', { name: 'Approve Claim', exact: true });
    await expect(approveBtn).toHaveCount(1);

    await approveBtn.click();
    const dialog = this.page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Approve claim', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The approval commits within seconds, but the console's post-approval router.refresh() re-fetches the whole
    // admin dataset and can keep the buttons disabled for a while. Wait for that transition to settle (row gone or
    // its Approve button re-enabled), then reload and assert against fresh server state.
    await expect(async () => {
      const remaining = await this.claimRow(utr).count();
      if (remaining > 0) await expect(approveBtn).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await reloadApp(this.page);
    await expect(this.adminConsoleHeading).toBeVisible({ timeout: 15_000 });
    await this.openPendingClaimsTab();
    await expect(this.claimRow(utr)).toHaveCount(0, { timeout: 15_000 });
  }

  async setBusinessPlan(businessName: string, plan: 'professional' | 'essentials'): Promise<void> {
    await this.page.getByRole('button', { name: /^Businesses Directory/ }).click();
    await expect(this.page.getByRole('heading', { name: /Client Businesses Directory/ })).toBeVisible({ timeout: 15_000 });

    const searchInput = this.page.getByPlaceholder('Search by legal name, trade name, GSTIN, or email...');
    await searchInput.fill(businessName);

    const row = this.page.locator('tbody tr').filter({ hasText: businessName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Manage', exact: true }).click();

    const dialogHeading = this.page.getByRole('heading', { name: new RegExp(`Manage Subscription: ${businessName}`) });
    await expect(dialogHeading).toBeVisible({ timeout: 15_000 });

    // The Manage Subscription dialog is a Base UI Dialog (role=dialog); scope every control to it.
    const dialog = this.page.getByRole('dialog').filter({ has: dialogHeading });

    // Select plan tier
    const planSelect = dialog.locator('select').first();
    await planSelect.selectOption(plan);

    // Ensure status is active
    const statusSelect = dialog.locator('select').nth(1);
    await statusSelect.selectOption('active');

    // Click +1 Year preset if needed
    const presetBtn = dialog.getByRole('button', { name: '+1 Year', exact: true });
    if (await presetBtn.isVisible()) {
      await presetBtn.click();
    }

    // BR-01: a manual change needs a reason; Save stays disabled until one is typed.
    const saveBtn = dialog.getByRole('button', { name: 'Save Subscription Changes', exact: true });
    await expect(saveBtn).toBeDisabled();
    await dialog.getByLabel(/Reason for this change/).fill(`E2E plan change to ${plan}`);
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    await expect(dialogHeading).toBeHidden({ timeout: 30_000 });

    await reloadApp(this.page);
    await expect(this.adminConsoleHeading).toBeVisible({ timeout: 15_000 });
    await this.page.getByRole('button', { name: /^Businesses Directory/ }).click();
    await searchInput.fill(businessName);
    const updatedRow = this.page.locator('tbody tr').filter({ hasText: businessName }).first();
    await expect(updatedRow).toContainText(plan, { timeout: 15_000, ignoreCase: true });
  }
}

