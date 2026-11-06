import { expect, type Locator, type Page } from '@playwright/test';

export class CheckoutPage {
  readonly page: Page;

  readonly planEssentialsButton: Locator;
  readonly planProfessionalButton: Locator;
  readonly utrInput: Locator;
  readonly submitButton: Locator;
  readonly successNotice: Locator;
  readonly pendingScreenIndicator: Locator;

  constructor(page: Page) {
    this.page = page;

    this.planEssentialsButton = page.locator('button:has-text("Essentials Pro Plan")');
    this.planProfessionalButton = page.locator('button:has-text("Enterprise / CA Max")');
    this.utrInput = page.locator('#payment_reference');
    this.submitButton = page.locator('button[type="submit"]:has-text("Submit Payment Claim")');
    this.successNotice = page.locator('text=Claim Submitted Successfully!');
    // Shown while a claim awaits admin verification (app/(app)/checkout: "Payment Claim Under Review").
    this.pendingScreenIndicator = page.getByRole('heading', { name: 'Payment Claim Under Review' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/checkout');
  }

  async submitClaim(utr: string): Promise<void> {
    // If pending screen is already displayed, no need to fill form
    if (await this.pendingScreenIndicator.isVisible().catch(() => false)) {
      return;
    }

    await expect(this.utrInput).toBeVisible();
    await this.utrInput.fill(utr);
    await this.submitButton.click();
  }

  /**
   * The success notice is transient: after the claim is stored the page refreshes into the "Payment Claim Under
   * Review" screen. Either one proves the claim was logged, so accept whichever is showing.
   */
  async expectSuccess(): Promise<void> {
    await expect(this.successNotice.or(this.pendingScreenIndicator).first()).toBeVisible({ timeout: 30_000 });
  }

  async expectPendingNotice(): Promise<void> {
    await expect(this.pendingScreenIndicator).toBeVisible({ timeout: 10_000 });
  }
}

