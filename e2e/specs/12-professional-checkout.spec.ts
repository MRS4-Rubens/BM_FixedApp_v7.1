import { test, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import { z } from 'zod';
import { loadE2eEnv } from '../support/env';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp } from '../support/navigation';
import { queryRows } from '../support/db';
import { loadJourneyState } from '../fixtures/test';
import { CheckoutPage } from '../pages/CheckoutPage';

test.describe.configure({ mode: 'serial' });

/**
 * Feature G (launch Professional), as the journey owner — screens only, no payment claim is submitted
 * (01-journey covers claims and approval; the plan-change money rule is covered by unit/integration/real-Postgres tests):
 * 1. /checkout?plan=professional: Professional is selectable (no "Coming soon"), ₹599 monthly, ₹4,999 yearly.
 * 2. The conversion note appears EXACTLY when it should: the business's real plan is read from the database, and the
 *    "unused days become" note must be visible when a different paid plan is running (Essentials → Professional) and
 *    absent otherwise.
 * 3. The landing page pricing shows Professional's price and no "Coming soon".
 */
test.describe('12 - Professional plan on sale: checkout and pricing', () => {
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');

  test('Professional is purchasable at its price, with the plan-change note when switching from Essentials', async ({ browser }) => {
    const env = loadE2eEnv(process.env);
    const journey = loadJourneyState();
    let context: BrowserContext | null = null;

    try {
      context = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: userAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const page = await context.newPage();
      const checkout = new CheckoutPage(page);

      // What the business is on right now decides whether the conversion note must show.
      const [business] = await queryRows(
        `SELECT subscription_plan, subscription_status, subscription_ends_at > now() AS running
         FROM businesses WHERE gstin = $1`,
        [journey.businessGstin],
        z.object({ subscription_plan: z.string(), subscription_status: z.string(), running: z.boolean().nullable() }),
        env,
      );
      expect(business).toBeDefined();
      const expectsUpgradeNote =
        business?.subscription_status === 'active' && business.subscription_plan === 'essentials' && business.running === true;

      // ── 1. Checkout ─────────────────────────────────────────────────────────
      await gotoApp(page, '/checkout?plan=professional');
      await expect(checkout.pendingScreenIndicator, 'a pending claim hides the plan picker').toHaveCount(0);
      const proCard = checkout.planProfessionalButton.first();
      await expect(proCard).toBeVisible({ timeout: 15_000 });
      await expect(proCard).toBeEnabled();
      await expect(proCard.getByText('Coming soon')).toHaveCount(0);

      await checkout.monthlyCycleButton.first().click();
      await expect(page.getByText('₹599').first()).toBeVisible();

      // ── 2. Conversion note (deterministic) ──────────────────────────────────
      const note = page.getByText(/unused days become \d+ days of Professional/);
      if (expectsUpgradeNote) {
        await expect(note.first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/No refunds or part-payments/).first()).toBeVisible();
      } else {
        await expect(note).toHaveCount(0);
      }

      await checkout.yearlyCycleButton.first().click();
      await expect(page.getByText('₹4,999').first()).toBeVisible();

      // ── 3. Landing page pricing ─────────────────────────────────────────────
      await gotoApp(page, '/');
      const pricing = page.locator('#pricing');
      await expect(pricing).toBeVisible({ timeout: 15_000 });
      await expect(pricing.getByText('Professional', { exact: true }).first()).toBeVisible();
      await expect(pricing.getByText('₹599').first()).toBeVisible();
      await expect(pricing.getByText('Coming soon')).toHaveCount(0);
    } finally {
      await context?.close();
    }
  });
});
