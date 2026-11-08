import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../support/navigation';

export class ReportsPage {
  readonly page: Page;

  readonly gstr1ExportButton: Locator;
  readonly unlockExportButton: Locator;
  readonly upgradeModalTitle: Locator;

  constructor(page: Page) {
    this.page = page;

    this.gstr1ExportButton = page.locator('a[href*="/api/reports/export?type=gstr1"]').first();
    this.unlockExportButton = page.locator('button:has-text("Unlock Excel Export"), a:has-text("Unlock Excel Export")').first();
    this.upgradeModalTitle = page.locator('text=Unlock Statutory Tax Exports');
  }

  async goto(): Promise<void> {
    await gotoApp(this.page, '/reports');
  }

  async expectTrialExportBlocked(): Promise<void> {
    await expect(this.unlockExportButton).toBeVisible();
    await this.unlockExportButton.click();
    await expect(this.upgradeModalTitle).toBeVisible();
    await this.page.keyboard.press('Escape');
  }

  async expectExportAvailable(): Promise<void> {
    await expect(this.gstr1ExportButton).toBeVisible();
  }

  async triggerGstr1Download(): Promise<Buffer> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.gstr1ExportButton.click(),
    ]);

    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error('Could not read downloaded XLSX stream');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }
}

