import { expect, type Locator, type Page } from '@playwright/test';
import { parseInrToPaise } from '../support/money';

/**
 * Finalized invoice detail page (components/app/invoices/invoice-detail.tsx + payment-section.tsx).
 * The page also renders the printable invoice document, which repeats labels such as "Grand Total"; locators are
 * therefore scoped to the interactive panels, never to bare text.
 */
export class InvoiceDetailPage {
  readonly page: Page;

  readonly settlementCardTitle: Locator;
  readonly settlementBadge: Locator;
  readonly paymentForm: Locator;
  readonly paymentAmountInput: Locator;
  readonly recordPaymentButton: Locator;
  readonly balanceDisplay: Locator;
  readonly issueCreditNoteLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.settlementCardTitle = page.getByText('Lifecycle & Settlement', { exact: true });
    // "<n>% Settled" pill in the Lifecycle & Settlement card.
    this.settlementBadge = page.getByText(/^\d{1,3}% Settled$/);
    this.recordPaymentButton = page.getByRole('button', { name: /^(Record Payment|Recording\.\.\.)$/ });
    this.paymentForm = page.locator('form').filter({ has: this.recordPaymentButton });
    this.paymentAmountInput = this.paymentForm.locator('input[type="number"]').first();
    this.balanceDisplay = page.locator('span').filter({ hasText: /^Balance:\s*₹/ }).first();
    this.issueCreditNoteLink = page.locator('a[href*="/credit-note/new"]').first();
  }

  async goto(invoiceId: string): Promise<void> {
    await this.page.goto(`/invoices/${invoiceId}`);
    await expect(this.settlementCardTitle).toBeVisible();
  }

  async getInvoiceNumber(): Promise<string> {
    // Statutory numbers look like "<PREFIX>/<YY-YY>/<SEQ>" (default "BMA/26-27/0001"); the prefix is configurable.
    const numberPattern = /[A-Z][A-Z0-9-]*\/\d{2}-\d{2}\/\d{3,}/;
    const heading = this.page.getByRole('heading', { level: 1 }).filter({ hasText: numberPattern }).first();
    if (await heading.isVisible().catch(() => false)) {
      const text = (await heading.innerText()).trim();
      return text.match(numberPattern)?.[0] ?? text;
    }
    const anyInvText = await this.page.locator('body').innerText();
    const match = anyInvText.match(numberPattern);
    return match ? match[0] : '';
  }

  /** Balance due in paise; 0 once the invoice is settled (the payment form is replaced by a "settled" card). */
  async getBalancePaise(): Promise<number> {
    const isSettled = await this.page.getByText(/Zero balance remaining/).isVisible().catch(() => false);
    if (isSettled) return 0;

    await expect(this.balanceDisplay).toBeVisible();
    const text = await this.balanceDisplay.innerText();
    const match = text.match(/₹[\d,.]+/);
    if (!match) throw new Error(`Could not find balance in: ${text}`);
    return parseInrToPaise(match[0]);
  }

  /** "paid" | "partially paid" | "unpaid", derived from the "<n>% Settled" pill. */
  async getPaymentStatusText(): Promise<string> {
    await expect(this.settlementBadge).toBeVisible();
    const percent = Number((await this.settlementBadge.innerText()).match(/^(\d{1,3})%/)?.[1] ?? NaN);
    if (Number.isNaN(percent)) return '';
    if (percent >= 100) return 'paid';
    return percent > 0 ? 'partially paid' : 'unpaid';
  }

  async recordPayment(rupees: number): Promise<void> {
    await expect(this.paymentAmountInput).toBeVisible();
    await this.paymentAmountInput.fill(rupees.toString());
    await this.recordPaymentButton.click();
    // The button reads "Recording..." while the server action runs. The page data then revalidates; callers
    // poll the balance/status rather than waiting for "networkidle" (which never settles on this page).
    await expect(this.page.getByRole('button', { name: 'Recording...' })).toHaveCount(0, { timeout: 30_000 });
  }

  async openCreditNote(): Promise<void> {
    await expect(this.issueCreditNoteLink).toBeVisible();
    await this.issueCreditNoteLink.click();
    await this.page.waitForURL(/\/credit-note\/new/, { timeout: 15_000 });
  }
}
