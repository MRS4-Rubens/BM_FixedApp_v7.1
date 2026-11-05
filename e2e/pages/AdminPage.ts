import { expect, type Locator, type Page } from '@playwright/test';

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
    await this.page.goto('/admin');
    await expect(this.adminConsoleHeading).toBeVisible({ timeout: 15_000 });
  }

  async approveClaimByUtr(utr: string): Promise<void> {
    // Locate the row containing the UTR
    const row = this.page.locator('tr, div').filter({ hasText: utr }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const approveBtn = row.locator('button:has-text("Approve"), button:has-text("Approve Claim")').first();
    await expect(approveBtn).toBeVisible();

    // Accept window.confirm() dialog
    this.page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await approveBtn.click();

    // Verify row leaves pending state
    await expect(row.locator('button:has-text("Approve"), button:has-text("Approve Claim")')).not.toBeVisible({
      timeout: 15_000,
    });
  }
}

