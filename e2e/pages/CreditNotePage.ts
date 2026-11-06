import { expect, type Locator, type Page } from '@playwright/test';
import { parseInrToPaise } from '../support/money';

export class CreditNotePage {
  readonly page: Page;

  readonly reasonSelect: Locator;
  readonly notesInput: Locator;
  readonly firstLineQtyInput: Locator;
  readonly finalizeButton: Locator;
  readonly saveDraftButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.reasonSelect = page.locator('select').filter({ hasText: /Sales Return|Deficiency/i });
    this.notesInput = page.locator('input[placeholder*="returned due to"]');
    this.firstLineQtyInput = page.locator('tbody tr input[type="number"]').first();
    this.finalizeButton = page.locator('button:has-text("Finalize & Issue")');
    this.saveDraftButton = page.locator('button:has-text("Save as Draft")');
  }

  async setQuantity(qty: number): Promise<void> {
    await expect(this.firstLineQtyInput).toBeVisible();
    await this.firstLineQtyInput.fill(qty.toString());
  }

  async getCreditTotalPaise(): Promise<number> {
    const totalRow = this.page.locator('div:has-text("Credit Note Total:"), tr:has-text("Total Credit:")').last();
    const text = await totalRow.innerText();
    const match = text.match(/₹[\d,.]+/);
    if (!match) throw new Error(`Could not find credit total in: ${text}`);
    return parseInrToPaise(match[0]);
  }

  async finalize(): Promise<void> {
    await expect(this.finalizeButton).toBeEnabled();
    await this.finalizeButton.click();
    // Finalizing runs a locked numbering transaction; on a cold preview it can exceed 15s.
    await this.page.waitForURL(/\/credit-notes\/[0-9a-fA-F-]+/, { timeout: 45_000 });
  }
}

