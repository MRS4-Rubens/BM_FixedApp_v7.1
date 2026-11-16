import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../support/navigation';

/** Settings > Users & Roles (owner view). Locators match components/app/settings/team-tab/*. */
export class TeamSettingsPage {
  readonly page: Page;
  readonly usersAndRolesTabButton: Locator;
  readonly heading: Locator;
  readonly inviteEmailInput: Locator;
  readonly sendInviteButton: Locator;
  readonly inviteLinkInput: Locator;
  readonly doneButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // The desktop and mobile settings navs both render this button; only the visible one is used.
    this.usersAndRolesTabButton = page.getByRole('button', { name: 'Users & Roles', exact: true });
    this.heading = page.getByRole('heading', { name: 'Users & Roles' });
    this.inviteEmailInput = page.getByLabel('E-mail address');
    this.sendInviteButton = page.getByRole('button', { name: 'Send invite' });
    this.inviteLinkInput = page.getByLabel('Invite link');
    this.doneButton = page.getByRole('button', { name: 'Done' });
  }

  async goto(): Promise<void> {
    await gotoApp(this.page, '/settings');
    await this.usersAndRolesTabButton.filter({ visible: true }).first().click();
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  /** Sends an invite and returns the link shown in the invite-link panel (works even if the e-mail failed). */
  async sendInvite(email: string): Promise<string> {
    await expect(this.inviteEmailInput).toBeEnabled({ timeout: 15_000 });
    await this.inviteEmailInput.fill(email);
    await this.sendInviteButton.click();
    await expect(this.inviteLinkInput).toBeVisible({ timeout: 20_000 });
    return this.inviteLinkInput.inputValue();
  }

  private memberRow(emailOrName: string): Locator {
    return this.page.locator('tr').filter({ hasText: emailOrName });
  }

  async expectMemberVisible(emailOrName: string): Promise<void> {
    await expect(this.memberRow(emailOrName)).toBeVisible({ timeout: 15_000 });
  }

  async expectMemberNotVisible(emailOrName: string): Promise<void> {
    await expect(this.memberRow(emailOrName)).toHaveCount(0, { timeout: 15_000 });
  }

  async removeMember(emailOrName: string): Promise<void> {
    await this.memberRow(emailOrName).getByRole('button', { name: 'Remove' }).click();
    const dialog = this.page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove member', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  }
}
