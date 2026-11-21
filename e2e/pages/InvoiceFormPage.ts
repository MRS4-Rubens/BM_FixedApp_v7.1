import { expect, type Locator, type Page } from '@playwright/test';
import { parseInrToPaise } from '../support/money';
import { gotoApp, waitForAppUrl } from '../support/navigation';

export class InvoiceFormPage {
  readonly page: Page;

  readonly billingNameInput: Locator;
  readonly billingGstinInput: Locator;
  readonly placeOfSupplySelect: Locator;

  readonly lineItem0Description: Locator;
  readonly lineItem0Qty: Locator;
  readonly lineItem0Price: Locator;
  readonly lineItem0TaxRate: Locator;

  readonly saveDraftButton: Locator;
  readonly finalizeButton: Locator;
  readonly previewButton: Locator;
  readonly previewVerifiedCheckbox: Locator;

  // Breakdown displays
  readonly summaryContainer: Locator;

  constructor(page: Page) {
    this.page = page;

    this.billingNameInput = page.locator('input[name="billing_name"]');
    this.billingGstinInput = page.locator('input[name="billing_gstin"]');
    this.placeOfSupplySelect = page.locator('select[name="place_of_supply_state_code"]');

    this.lineItem0Description = page.locator('input[name="line_items.0.description"]');
    this.lineItem0Qty = page.locator('input[name="line_items.0.quantity"]');
    this.lineItem0Price = page.locator('input[name="line_items.0.unit_price"]');
    this.lineItem0TaxRate = page.locator('select[name="line_items.0.tax_rate_id"]');

    this.saveDraftButton = page.locator('button:has-text("Save Draft")');
    this.finalizeButton = page.locator('button:has-text("Finalize Invoice")');
    this.previewButton = page.locator('#draft-preview-btn');
    this.previewVerifiedCheckbox = page.locator('label:has-text("Preview Verified") input[type="checkbox"]');

    this.summaryContainer = page.locator('div:has-text("Summary & GST Breakdown")');
  }

  async gotoNew(): Promise<void> {
    await gotoApp(this.page, '/invoices/new');
    await expect(this.billingNameInput).toBeVisible();
  }

  async selectCustomer(customerName: string): Promise<void> {
    await this.billingNameInput.fill(customerName);
    // Wait for dropdown suggestion
    const suggestion = this.page.locator(`button:has-text("${customerName}")`).first();
    await expect(suggestion).toBeVisible({ timeout: 5000 });
    await suggestion.click();
  }

  async selectProduct(productName: string, quantity = 3): Promise<void> {
    await this.lineItem0Description.fill(productName);
    const suggestion = this.page.locator(`button:has-text("${productName}")`).first();
    await expect(suggestion).toBeVisible({ timeout: 5000 });
    await suggestion.click();

    // Set quantity
    await this.lineItem0Qty.fill(quantity.toString());
  }

  async getOnScreenTaxablePaise(): Promise<number> {
    // Taxable Value row
    const row = this.page.locator('div:has-text("Taxable Value")').last();
    const text = await row.locator('span').last().innerText();
    return parseInrToPaise(text);
  }

  async getOnScreenCgstPaise(): Promise<number> {
    const row = this.page.locator('div:has-text("CGST")').last();
    const text = await row.locator('span').last().innerText();
    return parseInrToPaise(text);
  }

  async getOnScreenSgstPaise(): Promise<number> {
    const row = this.page.locator('div:has-text("SGST")').last();
    const text = await row.locator('span').last().innerText();
    return parseInrToPaise(text);
  }

  async getOnScreenGrandTotalPaise(): Promise<number> {
    const row = this.page.locator('div:has-text("Grand Total")').last();
    const text = await row.locator('span').last().innerText();
    return parseInrToPaise(text);
  }

  async saveDraft(): Promise<string> {
    await this.saveDraftButton.click();
    await waitForAppUrl(this.page, /\/invoices\/[0-9a-fA-F-]+/, 15_000);
    const url = this.page.url();
    const match = url.match(/\/invoices\/([0-9a-fA-F-]+)/);
    return match ? match[1]! : '';
  }

  async openPreviewAndVerify(): Promise<void> {
    await this.previewButton.click();
    await expect(this.previewVerifiedCheckbox).toBeVisible();
    await this.previewVerifiedCheckbox.check();

    // Close preview modal via the close button
    const closeBtn = this.page.getByRole('button', { name: 'Close preview' });
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
  }

  async finalize(): Promise<void> {
    await this.openPreviewAndVerify();

    await this.finalizeButton.click();
    const dialog = this.page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Finalize invoice', exact: true }).click();

    // The confirm dialog stays open (pending) until the save + finalize server actions finish, so wait for it to
    // close first. While it is open the page behind it is aria-hidden, which would make a heading check pass early
    // and let a follow-up navigation abort the in-flight finalize.
    await expect(dialog).toBeHidden({ timeout: 45_000 });
    // On success the app navigates to the same /invoices/<id> URL, so a URL wait alone returns immediately.
    // Wait for the draft editor to go away instead.
    await expect(this.page.getByRole('heading', { name: 'Edit Draft Invoice' })).toBeHidden({ timeout: 30_000 });
  }
}

