import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp, waitForAppUrl } from '../support/navigation';

export class CustomersPage {
  readonly page: Page;

  readonly nameInput: Locator;
  readonly gstinInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly addressLine1Input: Locator;
  readonly cityInput: Locator;
  readonly stateSelect: Locator;
  readonly pincodeInput: Locator;
  readonly submitButton: Locator;
  readonly successNotice: Locator;

  constructor(page: Page) {
    this.page = page;

    this.nameInput = page.locator('input[name="name"]');
    this.gstinInput = page.locator('input[name="gstin"]');
    this.emailInput = page.locator('input[name="email"]');
    this.phoneInput = page.locator('input[name="phone"]');
    this.addressLine1Input = page.locator('input[name="address_line1"]');
    this.cityInput = page.locator('input[name="city"]');
    this.stateSelect = page.locator('select[name="state_code"]');
    this.pincodeInput = page.locator('input[name="pincode"]');
    this.submitButton = page.locator('button[type="submit"]:has-text("Save & Add Customer")');
    this.successNotice = page.locator('text=Customer added successfully!');
  }

  async gotoNew(): Promise<void> {
    await gotoApp(this.page, '/customers/new');
    await expect(this.nameInput).toBeVisible();
  }

  async createCustomer(data: {
    name: string;
    gstin: string;
    stateCode: string;
    addressLine1?: string;
    city?: string;
    pincode?: string;
  }): Promise<void> {
    await this.nameInput.fill(data.name);
    await this.gstinInput.fill(data.gstin);
    await this.stateSelect.selectOption(data.stateCode);
    if (data.addressLine1) await this.addressLine1Input.fill(data.addressLine1);
    if (data.city) await this.cityInput.fill(data.city);
    if (data.pincode) await this.pincodeInput.fill(data.pincode);

    await this.submitButton.click();
  }

  async expectCreated(): Promise<void> {
    // Either redirected to /customers or success notice is shown
    await Promise.race([
      expect(this.successNotice).toBeVisible().catch(() => {}),
      waitForAppUrl(this.page, /\/customers/, 10_000).catch(() => {}),
    ]);
  }
}

