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

  /** The innermost element that contains both this UTR and an "Approve" button: exactly this claim's queue row. */
  private claimRow(utr: string): Locator {
    const approve = this.page.getByRole('button', { name: 'Approve', exact: true });
    return this.page.locator('div').filter({ hasText: utr }).filter({ has: approve }).last();
  }

  async approveClaimByUtr(utr: string): Promise<void> {
    const row = this.claimRow(utr);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const approveBtn = row.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveBtn).toHaveCount(1);

    await approveBtn.click();
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Approve claim', exact: true }).click();

    // The approval commits within seconds, but the console's post-approval router.refresh() re-fetches the whole
    // admin dataset and can keep the buttons disabled for a while. Wait for that transition to settle (row gone or
    // its Approve button re-enabled), then reload and assert against fresh server state.
    await expect(async () => {
      const remaining = await this.claimRow(utr).count();
      if (remaining > 0) await expect(approveBtn).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await this.page.reload();
    await expect(this.adminConsoleHeading).toBeVisible({ timeout: 15_000 });
    await expect(this.claimRow(utr)).toHaveCount(0, { timeout: 15_000 });
  }
}

