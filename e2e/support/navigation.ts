import type { Page, Response } from '@playwright/test';

/**
 * E2E navigation that does NOT wait for the browser "load" event.
 *
 * "load" waits for every sub-resource, including third-party ones (Google Fonts @import in the invoice templates,
 * Vercel preview scripts). One slow or blocked external request stalls it for 20–30 s even though the app is fully
 * usable — which made local runs flaky (server answered in ~0.5 s, browser then idle until the timeout).
 *
 * Instead: wait for the document to be parsed (domcontentloaded), then for the Next.js client runtime to be running
 * (`window.next` is set when the App Router client boots, just before hydration completes). Playwright locator
 * actions and web-first assertions then auto-wait for the exact elements a step needs.
 *
 * Use these helpers for every app navigation in E2E specs, page objects and the global setup. Specs that must see
 * the fully loaded page (axe a11y scans, print layout) keep `page.goto(url)` on purpose.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

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
