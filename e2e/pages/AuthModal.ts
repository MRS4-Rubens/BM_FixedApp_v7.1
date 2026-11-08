import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../support/navigation';

export class AuthModal {
  readonly page: Page;
  readonly modalDialog: Locator;

  // Signup fields
  readonly signupOwnerInput: Locator;
  readonly signupEmailInput: Locator;
  readonly signupPasswordInput: Locator;
  readonly signupConfirmPasswordInput: Locator;
  readonly termsCheckbox: Locator;
  readonly signupSubmitButton: Locator;

  // Login fields
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginSubmitButton: Locator;

  // Status & error messages
  readonly statusNotice: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modalDialog = page.locator('div[role="dialog"]');

    this.signupOwnerInput = page.locator('#signup-owner');
    this.signupEmailInput = page.locator('#signup-email');
    this.signupPasswordInput = page.locator('#signup-pass');
    this.signupConfirmPasswordInput = page.locator('#signup-confirm');
    this.termsCheckbox = page.locator('#terms');
    this.signupSubmitButton = page
      .locator('form')
      .filter({ has: this.signupOwnerInput })
      .locator('button[type="submit"]');

    this.loginEmailInput = page.locator('#login-email');
    this.loginPasswordInput = page.locator('#login-password');
    this.loginSubmitButton = page
      .locator('form')
      .filter({ has: this.loginEmailInput })
      .locator('button[type="submit"]');

    this.statusNotice = page.locator('div[role="status"]');
    this.errorBanner = page.locator('div.text-rose-700');
  }

  async openSignup(): Promise<void> {
    await gotoApp(this.page, '/?auth=signup');
    await expect(this.modalDialog).toBeVisible();
    await expect(this.signupEmailInput).toBeVisible();
  }

  async openLogin(): Promise<void> {
    await gotoApp(this.page, '/?auth=login');
    await expect(this.modalDialog).toBeVisible();
    await expect(this.loginEmailInput).toBeVisible();
  }

  async fillSignup(params: {
    ownerName: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.signupOwnerInput.fill(params.ownerName);
    await this.signupEmailInput.fill(params.email);
    await this.signupPasswordInput.fill(params.password);
    await this.signupConfirmPasswordInput.fill(params.password);
    await this.termsCheckbox.check();
  }

  async submitSignup(): Promise<void> {
    await this.signupSubmitButton.click();
  }

  async fillLogin(email: string, pass: string): Promise<void> {
    await this.loginEmailInput.fill(email);
    await this.loginPasswordInput.fill(pass);
  }

  async submitLogin(): Promise<void> {
    await this.loginSubmitButton.click();
  }

  async expectVerificationNotice(): Promise<void> {
    await expect(this.statusNotice).toBeVisible();
    await expect(this.statusNotice).toContainText('Please check your e-mail to verify');
  }

  async expectLoginError(): Promise<void> {
    await expect(this.errorBanner).toBeVisible();
  }
}

