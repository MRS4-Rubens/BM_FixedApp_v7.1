import { test, expect, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import { z } from 'zod';
import { loadE2eEnv } from '../support/env';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp, reloadApp, waitForAppUrl } from '../support/navigation';
import { queryRows } from '../support/db';
import { loadJourneyState } from '../fixtures/test';

test.describe.configure({ mode: 'serial' });

/**
 * Feature C (notifications), as the journey owner:
 * 1. The bell opens a Notifications panel (items or "all caught up") and closes with Escape; its settings link
 *    opens Settings → Notifications, which no longer says "Coming soon".
 * 2. E-mail choices: switching "Money to collect" off and the summary off persists across a reload (and in the
 *    database), then is restored.
 * 3. GST filing frequency: the owner chooses Quarterly (saved + audited in the DB), then Monthly.
 * The role-change notification itself is covered end-to-end in 09-ca (the person sees it in their bell).
 */
test.describe('11 - Notifications bell and settings', () => {
  const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');

  test('owner uses the bell and manages notification e-mails and the GST filing frequency', async ({ browser }) => {
    const env = loadE2eEnv(process.env);
    const journey = loadJourneyState();
    let context: BrowserContext | null = null;

    const prefsRow = z.object({ notification_prefs: z.record(z.string(), z.unknown()) });
    const frequencyRow = z.object({ gst_filing_frequency: z.string().nullable() });

    try {
      context = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: userAuthFile,
        baseURL: env.E2E_BASE_URL,
      });
      const page = await context.newPage();

      // ── 1. Bell ───────────────────────────────────────────────────────────────
      await gotoApp(page, '/dashboard');
      const bell = page.getByRole('button', { name: /^Notifications(, \d+ unread)?$/ });
      await expect(bell).toBeVisible({ timeout: 20_000 });
      await bell.click();
      const panel = page.getByRole('dialog', { name: 'Notifications' });
      await expect(panel).toBeVisible();
      await expect(
        panel.getByText("You're all caught up").or(panel.getByRole('list')),
      ).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);

      await bell.click();
      await panel.getByRole('link', { name: 'Notification settings' }).click();
      await waitForAppUrl(page, /\/settings\?tab=notifications/, 20_000);
      await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(0);

      // ── 2. E-mail choices persist ─────────────────────────────────────────────
      const money = page.getByRole('switch', { name: 'Money to collect' });
      await expect(money).toBeChecked();
      await money.uncheck();
      await page.getByRole('radio', { name: /No summary e-mail/ }).check();
      await page.getByRole('button', { name: 'Save e-mail choices' }).click();
      await expect(page.getByText('Your e-mail choices are saved.')).toBeVisible({ timeout: 15_000 });

      await reloadApp(page);
      await expect(page.getByRole('switch', { name: 'Money to collect' })).not.toBeChecked({ timeout: 15_000 });
      await expect(page.getByRole('radio', { name: /No summary e-mail/ })).toBeChecked();
      const [savedPrefs] = await queryRows(
        `SELECT u.notification_prefs FROM users u JOIN businesses b ON b.id = u.business_id
         WHERE b.gstin = $1 AND u.role = 'owner'`,
        [journey.businessGstin],
        prefsRow,
        env,
      );
      expect(savedPrefs?.notification_prefs).toMatchObject({ digest: 'off', email: { money: false } });

      // ── 3. GST filing frequency (owner only) ──────────────────────────────────
      await page.getByRole('radio', { name: /Quarterly \(QRMP\)/ }).check();
      await page.getByRole('button', { name: 'Save filing frequency' }).click();
      await expect(page.getByText('GST filing frequency saved.')).toBeVisible({ timeout: 15_000 });
      const [quarterly] = await queryRows(
        'SELECT gst_filing_frequency FROM businesses WHERE gstin = $1',
        [journey.businessGstin],
        frequencyRow,
        env,
      );
      expect(quarterly?.gst_filing_frequency).toBe('quarterly');

      await page.getByRole('radio', { name: /^Monthly/ }).check();
      await page.getByRole('button', { name: 'Save filing frequency' }).click();
      await expect(page.getByText('GST filing frequency saved.')).toBeVisible({ timeout: 15_000 });
    } finally {
      // Restore the owner's e-mail choices (defaults) so later runs start the same way.
      try {
        if (context) {
          const page = context.pages()[0] ?? (await context.newPage());
          await gotoApp(page, '/settings?tab=notifications');
          const money = page.getByRole('switch', { name: 'Money to collect' });
          await expect(money).toBeVisible({ timeout: 15_000 });
          await money.check();
          await page.getByRole('radio', { name: /One summary e-mail every morning/ }).check();
          const save = page.getByRole('button', { name: 'Save e-mail choices' });
          if (await save.isEnabled()) {
            await save.click();
            await expect(page.getByText('Your e-mail choices are saved.')).toBeVisible({ timeout: 15_000 });
          }
        }
      } catch (err) {
        console.error('Failed to restore notification e-mail choices in E2E cleanup:', err);
      }
      await context?.close();
    }
  });
});
