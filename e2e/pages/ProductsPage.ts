import { expect, type Locator, type Page } from '@playwright/test';

export class ProductsPage {
  readonly page: Page;

  readonly nameInput: Locator;
  readonly hsnInput: Locator;
  readonly uomSelect: Locator;
  readonly priceInput: Locator;
  readonly taxRateSelect: Locator;
  readonly stockInput: Locator;
  readonly descriptionInput: Locator;
  readonly submitButton: Locator;
  readonly successNotice: Locator;

  constructor(page: Page) {
    this.page = page;

    this.nameInput = page.locator('input[name="name"]');
    this.hsnInput = page.locator('input[name="hsn_sac_code"]');
    this.uomSelect = page.locator('select[name="unit_of_measurement"]');
    this.priceInput = page.locator('input[name="default_sale_price"]');
    this.taxRateSelect = page.locator('select[name="default_tax_rate_id"]');
    this.stockInput = page.locator('input[name="stock_quantity"]');
    this.descriptionInput = page.locator('textarea[name="description"]');
    this.submitButton = page.locator('button[type="submit"]:has-text("Save & Add Product")');
    this.successNotice = page.locator('text=Product added successfully!');
  }

  async gotoNew(): Promise<void> {
    await this.page.goto('/products/new');
    await expect(this.nameInput).toBeVisible();
  }

  async createProduct(data: {
    name: string;
    hsn: string;
    unitPriceRupees: number;
    uom?: string;
    taxRateOptionText?: string;
  }): Promise<void> {
    await this.nameInput.fill(data.name);
    await this.hsnInput.fill(data.hsn);
    await this.priceInput.fill(data.unitPriceRupees.toString());

    if (data.uom) {
      await this.uomSelect.selectOption(data.uom);
    }

    // Options render as "<label> GST (<rate>%)", e.g. "18% GST (18.00%)", so match on the leading label text
    // and select by value. Defaults to the 18% slab.
    const wanted = data.taxRateOptionText ?? '18%';
    const options = await this.taxRateSelect
      .locator('option')
      .evaluateAll((els) => els.map((el) => ({ value: (el as HTMLOptionElement).value, text: (el.textContent ?? '').trim() })));
    const match = options.find((option) => option.value !== '' && option.text.startsWith(wanted));
    if (!match) {
      throw new Error(`No tax rate option starts with "${wanted}". Options: ${options.map((o) => o.text).join(' | ')}`);
    }
    await this.taxRateSelect.selectOption(match.value);

    await this.submitButton.click();
  }

  async expectCreated(): Promise<void> {
    await Promise.race([
      expect(this.successNotice).toBeVisible().catch(() => {}),
      this.page.waitForURL(/\/products/, { timeout: 10_000 }).catch(() => {}),
    ]);
  }
}

