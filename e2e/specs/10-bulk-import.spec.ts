import { test, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import { loadE2eEnv } from '../support/env';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp } from '../support/navigation';
import { generateRunId } from '../support/identity';
import { resetAuthRateLimits } from '../support/rate-limits';
import { loadJourneyState } from '../fixtures/test';
import { AdminPage } from '../pages/AdminPage';
import { makeGstin } from '../support/gstin';

test.describe.configure({ mode: 'serial' });

/**
 * Feature D (Bulk Customer & Product Import):
 * 1. Owner on Essentials plan sees "Professional plan required" state when opening Import dialog.
 * 2. Admin upgrades business to Professional plan via manual override.
 * 3. Customers: Upload CSV with valid, unregistered, and invalid rows.
 *    Expect Ready 2, Errors 1. Click Import -> "Imported 2 customers." -> visible in /customers.
 * 4. Re-upload identical CSV: Expect Duplicates 2, Ready 0 -> import button disabled ("Nothing to import").
 * 5. Products: Upload CSV with 2 valid products.
 *    Click Import -> "Imported 2 products." -> visible in /products.
 * 6. Finally: Restore business plan to Essentials.
 */
test.describe('10 - Bulk Customer and Product Import Journey', () => {
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');
  const adminAuthFile = path.resolve(process.cwd(), 'e2e/.auth/admin.json');

  test('bulk import customers and products on professional plan with validation and duplicate detection', async ({
    browser,
  }) => {
    const env = loadE2eEnv(process.env);
    await resetAuthRateLimits(env);

    const journeyState = loadJourneyState();
    const businessName = journeyState.businessName;
    const runId = generateRunId();

    let ownerContext: BrowserContext | null = null;
    let adminContext: BrowserContext | null = null;
    let adminPageObj: AdminPage | null = null;

    try {
      // ── Step 1: Owner on Essentials sees Professional plan required ───────────
      ownerContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: userAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const ownerPage = await ownerContext.newPage();

      await gotoApp(ownerPage, '/customers');
      const custImportBtn = ownerPage.getByRole('button', { name: 'Import', exact: true });
      await expect(custImportBtn).toBeVisible({ timeout: 15_000 });
      await custImportBtn.click();

      const dialog = ownerPage.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(
        ownerPage.getByText(
          'Bulk import of customers and products is part of the Professional plan.',
        ),
      ).toBeVisible();
      // No file upload input visible in plan-required state
      await expect(ownerPage.locator('input[type="file"]')).toHaveCount(0);

      // Close dialog
      await ownerPage.getByRole('button', { name: 'Close dialog' }).click();
      await expect(dialog).toBeHidden();

      // ── Step 2: Admin upgrades business to Professional ───────────────────────
      adminContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: adminAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const adminPage = await adminContext.newPage();
      adminPageObj = new AdminPage(adminPage);
      await adminPageObj.goto();
      await adminPageObj.setBusinessPlan(businessName, 'professional');

      // ── Step 3: Customers CSV Import ──────────────────────────────────────────
      await gotoApp(ownerPage, '/customers');
      await ownerPage.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const fileInput = ownerPage.locator('input[type="file"]');
      await expect(fileInput).toBeAttached({ timeout: 10_000 });

      const cust1Name = `Valid Cust ${runId}`;
      const cust2Name = `NoGST Cust ${runId}`;
      const cust3Name = `BadGST Cust ${runId}`;
      const customersCsv = [
        'Name,GSTIN,State,Pincode',
        `${cust1Name},${makeGstin('29')},Karnataka,560001`,
        `${cust2Name},,Karnataka,560002`,
        `${cust3Name},BADGSTIN,Karnataka,560003`,
      ].join('\n');

      await fileInput.setInputFiles({
        name: 'customers.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(customersCsv, 'utf-8'),
      });

      const checkBtn = ownerPage.getByRole('button', { name: 'Check file' });
      await expect(checkBtn).toBeEnabled({ timeout: 5_000 });
      await checkBtn.click();

      // Expect preview table with Ready 2, Errors 1
      const import2CustBtn = ownerPage.getByRole('button', { name: 'Import 2 customers' });
      await expect(import2CustBtn).toBeVisible({ timeout: 15_000 });
      await expect(ownerPage.getByText('Ready (2)')).toBeVisible();
      await expect(ownerPage.getByText('Errors (1)')).toBeVisible();

      await import2CustBtn.click();

      // Success screen
      await expect(ownerPage.getByText('Imported 2 customers.')).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        ownerPage.getByText('Skipped 0 duplicates and 1 row with errors.', { exact: false }),
      ).toBeVisible();

      const doneBtn = ownerPage.getByRole('button', { name: 'Done' });
      await doneBtn.click();
      await expect(dialog).toBeHidden();

      // Verify imported customers in the list
      await expect(ownerPage.getByText(cust1Name)).toBeVisible({ timeout: 15_000 });
      await expect(ownerPage.getByText(cust2Name)).toBeVisible({ timeout: 15_000 });

      // ── Step 4: Re-upload duplicate CSV ───────────────────────────────────────
      await ownerPage.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const reFileInput = ownerPage.locator('input[type="file"]');
      await expect(reFileInput).toBeAttached({ timeout: 10_000 });
      await reFileInput.setInputFiles({
        name: 'customers-dup.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(customersCsv, 'utf-8'),
      });

      await ownerPage.getByRole('button', { name: 'Check file' }).click();

      // Expect duplicates detected and import button disabled
      const nothingToImportBtn = ownerPage.getByRole('button', {
        name: 'Nothing to import',
      });
      await expect(nothingToImportBtn).toBeVisible({ timeout: 15_000 });
      await expect(nothingToImportBtn).toBeDisabled();
      await expect(ownerPage.getByText('Duplicates (2)')).toBeVisible();

      await ownerPage.getByRole('button', { name: 'Close dialog' }).click();
      await expect(dialog).toBeHidden();

      // ── Step 5: Products CSV Import ───────────────────────────────────────────
      await gotoApp(ownerPage, '/products');
      const prodImportBtn = ownerPage.getByRole('button', { name: 'Import', exact: true });
      await expect(prodImportBtn).toBeVisible({ timeout: 15_000 });
      await prodImportBtn.click();
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const prodFileInput = ownerPage.locator('input[type="file"]');
      await expect(prodFileInput).toBeAttached({ timeout: 10_000 });

      const prod1Name = `Cotton Fabric ${runId}`;
      const prod2Name = `Sewing Service ${runId}`;
      const productsCsv = [
        'Name,HSN/SAC code,Sale price (Rs),GST rate (%),Unit',
        `${prod1Name},6205,499,18,PCS`,
        `${prod2Name},998714,1250,5,NOS`,
      ].join('\n');

      await prodFileInput.setInputFiles({
        name: 'products.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(productsCsv, 'utf-8'),
      });

      await ownerPage.getByRole('button', { name: 'Check file' }).click();

      const import2ProdBtn = ownerPage.getByRole('button', { name: 'Import 2 products' });
      await expect(import2ProdBtn).toBeVisible({ timeout: 15_000 });
      await import2ProdBtn.click();

      await expect(ownerPage.getByText('Imported 2 products.')).toBeVisible({
        timeout: 15_000,
      });

      await ownerPage.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      // Verify products in list
      await expect(ownerPage.getByText(prod1Name)).toBeVisible({ timeout: 15_000 });
      await expect(ownerPage.getByText(prod2Name)).toBeVisible({ timeout: 15_000 });
    } finally {
      // ── Step 6: Cleanup - restore business plan to essentials ─────────────────
      try {
        if (adminPageObj) {
          await adminPageObj.goto();
          await adminPageObj.setBusinessPlan(businessName, 'essentials');
        }
      } catch (err) {
        console.error('Failed to restore business plan to essentials in E2E cleanup:', err);
      }

      await adminContext?.close();
      await ownerContext?.close();
    }
  });
});
