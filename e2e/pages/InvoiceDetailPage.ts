import { expect, type Locator, type Page } from '@playwright/test';
import { parseInrToPaise } from '../support/money';

export class InvoiceDetailPage {
  readonly page: Page;

  readonly invoiceNumberBadge: Locator;
  readonly paymentStatusBadge: Locator;
  readonly grandTotalDisplay: Locator;
  readonly balanceDisplay: Locator;

  readonly paymentAmountInput: Locator;
  readonly recordPaymentButton: Locator;
  readonly issueCreditNoteLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.invoiceNumberBadge = page.locator('span.font-mono.font-bold').first();
    this.paymentStatusBadge = page.locator('span[class*="uppercase tracking-wider"]').first();
    this.grandTotalDisplay = page.locator('div:has-text("Grand Total")').last();
    this.balanceDisplay = page.locator('span:has-text("Balance:")');

    this.paymentAmountInput = page.locator('input[name="amount"]');
    this.recordPaymentButton = page.locator('button:has-text("Record Payment")');
    this.issueCreditNoteLink = page.locator('a[href*="/credit-note/new"]').first();
  }

  async goto(invoiceId: string): Promise<void> {
    await this.page.goto(`/invoices/${invoiceId}`);
    await expect(this.grandTotalDisplay).toBeVisible();
  }

  async getInvoiceNumber(): Promise<string> {
    // Header displays invoice number prominently
    const heading = this.page.locator('h1, span.font-mono').filter({ hasText: /INV\// }).first();
    if (await heading.isVisible().catch(() => false)) {
      return (await heading.innerText()).trim();
    }
    const anyInvText = await this.page.locator('body').innerText();
    const match = anyInvText.match(/INV\/\d{4}-\d{2}\/\d{4}/);
    return match ? match[0] : '';
  }

  async getBalancePaise(): Promise<number> {
    const isSettled = await this.page.locator('text=Zero balance remaining').isVisible().catch(() => false);
    if (isSettled) return 0;

    await expect(this.balanceDisplay).toBeVisible();
    const text = await this.balanceDisplay.innerText();
    // "Balance: ₹2,040.00"
    const match = text.match(/₹[\d,.]+/);
    if (!match) throw new Error(`Could not find balance in: ${text}`);
    return parseInrToPaise(match[0]);
  }

  async getPaymentStatusText(): Promise<string> {
    const badges = this.page.locator('span[class*="uppercase tracking-wider"]');
    const count = await badges.count();
    for (let i = 0; i < count; i += 1) {
      const text = (await badges.nth(i).innerText()).toLowerCase();
      if (
        text.includes('paid') ||
        text.includes('partially paid') ||
        text.includes('unpaid') ||
        text.includes('overdue')
      ) {
        return text;
      }
    }
    return '';
  }

  async recordPayment(rupees: number): Promise<void> {
    await expect(this.paymentAmountInput).toBeVisible();
    await this.paymentAmountInput.fill(rupees.toString());
    await this.recordPaymentButton.click();
    // Wait for the button state to finish or refresh
    await expect(this.recordPaymentButton.locator('text=Recording...')).not.toBeVisible({ timeout: 10_000 });
  }

  async openCreditNote(): Promise<void> {
    await expect(this.issueCreditNoteLink).toBeVisible();
    await this.issueCreditNoteLink.click();
    await this.page.waitForURL(/\/credit-note\/new/, { timeout: 15_000 });
  }
}

