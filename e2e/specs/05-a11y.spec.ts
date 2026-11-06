import { test, expect } from '../fixtures/test';
import AxeBuilder from '@axe-core/playwright';
import * as path from 'path';
import * as fs from 'fs';
import {
  diffAgainstBaseline,
  loadBaselineFile,
  saveBaselineFile,
  type A11yBaseline,
} from '../support/a11y-baseline';
import { loadJourneyState } from '../fixtures/test';

const BASELINE_PATH = path.resolve(process.cwd(), 'e2e/a11y-baseline.json');
const USER_STATE_PATH = path.resolve(process.cwd(), 'e2e/.auth/user.json');
const ADMIN_STATE_PATH = path.resolve(process.cwd(), 'e2e/.auth/admin.json');

async function auditPageA11y(
  page: import('@playwright/test').Page,
  pageKey: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  const currentViolations: Record<string, number> = {};
  for (const violation of results.violations) {
    currentViolations[violation.id] = violation.nodes.length;
  }

  const baseline: A11yBaseline = loadBaselineFile(BASELINE_PATH) ?? {};
  const diff = diffAgainstBaseline(currentViolations, baseline[pageKey]);

  if (process.env.UPDATE_A11Y_BASELINE === '1' || process.env.UPDATE_A11Y_BASELINE === 'true') {
    baseline[pageKey] = currentViolations;
    saveBaselineFile(BASELINE_PATH, baseline);
  }

  expect(
    diff.regressions,
    `Accessibility regressions detected on [${pageKey}]: ${JSON.stringify(diff.regressions, null, 2)}`
  ).toEqual([]);
}

test.describe('05 - Accessibility Ratchet (WCAG 2.1 AA)', () => {
  test('audit marketing landing page with auth modal open', async ({ page, authModal }) => {
    await page.goto('/');
    await authModal.openLogin();
    await expect(page.getByRole('dialog')).toBeVisible();

    await auditPageA11y(page, 'marketing_auth_modal');
  });

  test.describe('authenticated user workspace routes', () => {
    test.beforeEach(async () => {
      if (!fs.existsSync(USER_STATE_PATH)) {
        test.skip(true, 'e2e/.auth/user.json not found; requires journey spec to run first');
      }
    });

    test.use({ storageState: USER_STATE_PATH });

    test('audit /dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/.*dashboard.*/);
      await auditPageA11y(page, 'dashboard');
    });

    test('audit /invoices list', async ({ page }) => {
      await page.goto('/invoices');
      await expect(page).toHaveURL(/.*invoices.*/);
      await auditPageA11y(page, 'invoices_list');
    });

    test('audit /invoices/new form', async ({ page }) => {
      await page.goto('/invoices/new');
      await expect(page).toHaveURL(/.*invoices\/new.*/);
      await auditPageA11y(page, 'invoice_form');
    });

    test('audit finalized invoice detail page', async ({ page }) => {
      const journey = loadJourneyState();
      if (!journey?.invoiceId) {
        test.skip(true, 'No journey state invoiceId recorded; skipping detail a11y');
        return;
      }

      await page.goto(`/invoices/${journey.invoiceId}`);
      await expect(page).toHaveURL(new RegExp(`.*invoices/${journey.invoiceId}.*`));
      await auditPageA11y(page, 'invoice_detail');
    });

    test('audit /customers list', async ({ page }) => {
      await page.goto('/customers');
      await expect(page).toHaveURL(/.*customers.*/);
      await auditPageA11y(page, 'customers_list');
    });

    test('audit /products list', async ({ page }) => {
      await page.goto('/products');
      await expect(page).toHaveURL(/.*products.*/);
      await auditPageA11y(page, 'products_list');
    });

    test('audit /settings', async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL(/.*settings.*/);
      await auditPageA11y(page, 'settings');
    });

    test('audit /reports', async ({ page }) => {
      await page.goto('/reports');
      await expect(page).toHaveURL(/.*reports.*/);
      await auditPageA11y(page, 'reports');
    });

    test('audit /checkout', async ({ page }) => {
      await page.goto('/checkout');
      await expect(page).toHaveURL(/.*checkout.*/);
      await auditPageA11y(page, 'checkout');
    });
  });

  test.describe('admin console route', () => {
    test.beforeEach(async () => {
      if (!fs.existsSync(ADMIN_STATE_PATH)) {
        test.skip(true, 'e2e/.auth/admin.json not found; platform admin not configured');
      }
    });

    test.use({ storageState: ADMIN_STATE_PATH });

    test('audit /admin console', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL(/.*admin.*/);
      await auditPageA11y(page, 'admin_console');
    });
  });
});

