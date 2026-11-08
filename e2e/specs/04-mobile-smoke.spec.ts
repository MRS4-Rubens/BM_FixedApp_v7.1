import { test, expect } from '../fixtures/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoApp } from '../support/navigation';

test.describe('04 - Mobile Smoke (375x667)', () => {
  const userStatePath = path.resolve(process.cwd(), 'e2e/.auth/user.json');

  test.beforeEach(async () => {
    if (!fs.existsSync(userStatePath)) {
      test.skip(true, 'e2e/.auth/user.json not found; requires journey spec to run first');
    }
  });

  test.use({
    storageState: userStatePath,
  });

  test('dashboard has no horizontal overflow and primary actions are visible', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await gotoApp(page, '/dashboard');
    await expect(page).toHaveURL(/.*dashboard.*/);

    // Verify no horizontal overflow (tolerance 1px for fractional subpixel layout)
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noOverflow).toBe(true);

    // Check primary navigation / actions are visible
    const newInvoiceBtn = page.getByRole('link', { name: /create|new invoice/i });
    if (await newInvoiceBtn.count() > 0) {
      await expect(newInvoiceBtn.first()).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  });

  test('invoice form has responsive layout and accessible controls without overflow', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await gotoApp(page, '/invoices/new');
    await expect(page).toHaveURL(/.*invoices\/new.*/);

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noOverflow).toBe(true);

    // Assert inputs and action button are accessible
    // Customer is chosen through the billing-name combobox input (same field the journey uses).
    await expect(page.locator('input[name="billing_name"]')).toBeVisible();
    await expect(page.locator('#draft-preview-btn')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('checkout page is responsive with no overflow', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await gotoApp(page, '/checkout');
    await expect(page).toHaveURL(/.*checkout.*/);

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(noOverflow).toBe(true);

    // Assert checkout card or plan is visible
    await expect(page.getByRole('heading', { name: /subscription|plan|checkout|tier/i }).first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

