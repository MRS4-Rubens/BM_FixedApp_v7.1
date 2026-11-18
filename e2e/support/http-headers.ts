/**
 * HTTP headers every E2E browser context sends. Used by playwright.config.ts, the global setup and any spec that
 * opens its own browser context.
 *
 * LAUNCH-L5: E2E now runs the app on the CI runner (`next start`, http://localhost:3000), so the Vercel preview
 * headers (toolbar skip, Deployment Protection bypass) are gone. Kept as the single place to add headers later.
 */
export function e2eExtraHttpHeaders(): Record<string, string> {
  return {};
}
