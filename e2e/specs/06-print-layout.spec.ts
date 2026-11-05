import { test, expect } from '../fixtures/test';
import * as path from 'path';
import * as fs from 'fs';
import { loadJourneyState } from '../fixtures/test';

const USER_STATE_PATH = path.resolve(process.cwd(), 'e2e/.auth/user.json');

test.describe('06 - Print Layout & PDF Generation', () => {
  test.beforeEach(async () => {
    if (!fs.existsSync(USER_STATE_PATH)) {
      test.skip(true, 'e2e/.auth/user.json not found; requires journey spec to run first');
    }
  });

  test.use({ storageState: USER_STATE_PATH });

  test('finalized invoice print layout hides chrome and fits A4 page', async ({ page }) => {
    const journey = loadJourneyState();
    if (!journey?.invoiceId) {
      test.skip(true, 'No journey state invoiceId recorded; requires 01-journey to run first');
      return;
    }

    await page.goto(`/invoices/${journey.invoiceId}`);
    await expect(page).toHaveURL(new RegExp(`.*invoices/${journey.invoiceId}.*`));

    // Wait for the invoice detail container to load
    await expect(page.locator('#inv-controls')).toBeVisible();

    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    // 1. Sidebar, topbar and invoice controls should be hidden in print mode
    const sidebar = page.locator('aside, [data-testid="app-sidebar"]').first();
    if (await sidebar.count() > 0) {
      const sidebarDisplay = await sidebar.evaluate((el) => window.getComputedStyle(el).display);
      expect(sidebarDisplay).toBe('none');
    }

    const topbar = page.locator('header').first();
    if (await topbar.count() > 0) {
      const topbarDisplay = await topbar.evaluate((el) => window.getComputedStyle(el).display);
      expect(topbarDisplay).toBe('none');
    }

    const controls = page.locator('#inv-controls');
    if (await controls.count() > 0) {
      const controlsDisplay = await controls.evaluate((el) => window.getComputedStyle(el).display);
      expect(controlsDisplay).toBe('none');
    }

    // 2. Printable invoice view should be visible and not exceed A4 width (794px + 2px tolerance)
    const printView = page.locator('.print\\:block');
    await expect(printView).toBeVisible();

    const boundingBox = await printView.boundingBox();
    expect(boundingBox).not.toBeNull();
    if (boundingBox) {
      expect(boundingBox.width).toBeLessThanOrEqual(796); // 794px + 2px tolerance
    }

    // 3. Generate PDF via Playwright (Chromium only)
    const pdfBuffer = await page.pdf({ format: 'A4' });
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(100);

    // Verify PDF header magic bytes "%PDF-"
    const pdfHeader = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(pdfHeader).toBe('%PDF-');

    // Verify PDF contains EOF trailer marker
    const pdfString = pdfBuffer.toString('latin1');
    expect(pdfString).toContain('%%EOF');
  });
});

