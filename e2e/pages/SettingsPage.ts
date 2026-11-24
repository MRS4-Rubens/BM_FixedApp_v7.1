import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../support/navigation';

export class SettingsPage {
  readonly page: Page;

  readonly legalNameInput: Locator;
  readonly gstinInput: Locator;
  readonly stateSelect: Locator;
  readonly addressLine1Input: Locator;
  readonly cityInput: Locator;
  readonly pincodeInput: Locator;
  readonly saveProfileButton: Locator;
  readonly successMessage: Locator;

  readonly skipTourButton: Locator;
  readonly celebrationDismissButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.legalNameInput = page.locator('input[name="legal_name"]');
    this.gstinInput = page.locator('input[name="gstin"]');
    this.stateSelect = page.locator('select[name="state_code"]');
    this.addressLine1Input = page.locator('input[name="address_line1"]');
    this.cityInput = page.locator('input[name="city"]');
    this.pincodeInput = page.locator('input[name="pincode"]');
    this.saveProfileButton = page.getByRole('complementary', { name: 'Settings panel' })
      .getByRole('button', { name: 'Save Profile', exact: true });
    this.successMessage = page.locator('text=Profile saved successfully');

    this.skipTourButton = page.locator('button:has-text("I\'ll do it myself (Skip)")');
    this.celebrationDismissButton = page.locator('button:has-text("Go to Dashboard Now")');
  }

  private tourHandlerRegistered = false;

  async goto(): Promise<void> {
    // The "Welcome to Business Setup" tour modal opens asynchronously after load and covers the form, so a
    // one-off visibility check races it. A locator handler dismisses it whenever it appears before an action.
    if (!this.tourHandlerRegistered) {
      await this.page.addLocatorHandler(this.skipTourButton, async () => {
        await this.skipTourButton.click();
      });
      this.tourHandlerRegistered = true;
    }
    await gotoApp(this.page, '/settings');
    await this.dismissTourIfPresent();
  }

  async dismissTourIfPresent(): Promise<void> {
    // Once the locator handler is registered it dismisses the modal before any action; clicking it here as well
    // would race the handler (the button disappears mid-click).
    if (this.tourHandlerRegistered) return;
    const isSkipVisible = await this.skipTourButton.isVisible().catch(() => false);
    if (isSkipVisible) {
      await this.skipTourButton.click();
    }
  }

  async fillProfile(data: {
    legalName: string;
    gstin: string;
    stateCode: string;
    addressLine1: string;
    city: string;
    pincode: string;
  }): Promise<void> {
    await this.dismissTourIfPresent();
    await this.legalNameInput.fill(data.legalName);
    await this.gstinInput.fill(data.gstin);
    await this.stateSelect.selectOption(data.stateCode);
    await this.addressLine1Input.fill(data.addressLine1);
    await this.cityInput.fill(data.city);
    await this.pincodeInput.fill(data.pincode);
  }

  async saveProfile(): Promise<void> {
    await this.saveProfileButton.click();
  }

  async expectSaved(): Promise<void> {
    // Either celebration modal pops up or success toast shows
    const celebration = this.celebrationDismissButton;
    const toast = this.successMessage;

    await expect(celebration.or(toast).first()).toBeVisible();

    if (await celebration.isVisible().catch(() => false)) {
      await celebration.click();
    }
  }
}

