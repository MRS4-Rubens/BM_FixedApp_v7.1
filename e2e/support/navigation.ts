import type { Page, Response } from '@playwright/test';

/**
 * E2E navigation that does NOT wait for the browser "load" event.
 *
 * "load" waits for every sub-resource, including third-party ones (Google Fonts @import in the invoice templates,
 * Vercel preview scripts). One slow or blocked external request stalls it for 20–30 s even though the app is fully
 * usable — which made local runs flaky (server answered in ~0.5 s, browser then idle until the timeout).
 *
 * Instead: wait for the document to be parsed (domcontentloaded), then for the Next.js client runtime to have started
 * (`window.next`), then for "load" for at most LOAD_GRACE_MS. `window.next` alone is NOT enough — it appears before
 * React hydration finishes, and early clicks were silently ignored — so the bounded "load" wait is what guarantees
 * hydration in the normal case, while a stalled "load" no longer fails the test. Playwright locator actions and
 * web-first assertions then auto-wait for the exact elements a step needs.
 *
 * Use these helpers for every app navigation in E2E specs, page objects and the global setup. Specs that must see
 * the fully loaded page (axe a11y scans, print layout) keep `page.goto(url)` on purpose.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Bounded grace period for the "load" event. `window.next` is set when the Next.js client STARTS booting — before
 * React has hydrated the page — so clicking right after it can hit buttons whose handlers are not attached yet
 * (verified: a recorded payment and a credit-note finalize were silently ignored). Normally "load" fires ~0.6 s after
 * navigation, by which time hydration is done. When a third-party request stalls "load", the app is already hydrated
 * (traces showed in-app navigation completing while "load" was still pending), so we continue after this grace period
 * instead of failing at the full timeout.
 */
export const LOAD_GRACE_MS = 10_000;

export async function waitForAppReady(page: Page, timeout: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { next?: unknown };
      return typeof w.next === 'object' && w.next !== null;
    },
    null,
    { timeout },
  );
  await page.waitForLoadState('load', { timeout: Math.min(LOAD_GRACE_MS, timeout) }).catch(() => {
    // "load" stalled on a slow sub-resource; the app itself is usable (see LOAD_GRACE_MS).
  });
}

/** Navigate to an app URL and wait until the app is usable (not until every sub-resource has loaded). */
export async function gotoApp(page: Page, url: string, timeout: number = DEFAULT_TIMEOUT_MS): Promise<Response | null> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await waitForAppReady(page, timeout);
  return response;
}

/** Wait for an in-app navigation (redirect, router push) to reach a URL, then for the app to be usable. */
export async function waitForAppUrl(
  page: Page,
  url: string | RegExp | ((url: URL) => boolean),
  timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await page.waitForURL(url, { waitUntil: 'commit', timeout });
  await waitForAppReady(page, timeout);
}

/** Reload the current page and wait until the app is usable. */
export async function reloadApp(page: Page, timeout: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded', timeout });
  await waitForAppReady(page, timeout);
}
