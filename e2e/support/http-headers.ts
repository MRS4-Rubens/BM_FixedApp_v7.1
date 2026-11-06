/**
 * HTTP headers every E2E browser context must send to a Vercel Preview deployment. Used by playwright.config.ts,
 * the global setup and any spec that opens its own browser context (e.g. the admin session in the journey).
 *
 * - x-vercel-skip-toolbar: disables the Vercel feedback toolbar injected into previews (it overlays the page and
 *   its external scripts can delay the "load" event). Vercel documents it for automated tests.
 * - x-vercel-protection-bypass (+ set-bypass-cookie): passes Deployment Protection with the automation secret.
 */
export function e2eExtraHttpHeaders(bypassSecret: string | undefined = process.env.E2E_VERCEL_BYPASS_SECRET): Record<string, string> {
  const headers: Record<string, string> = { 'x-vercel-skip-toolbar': '1' };
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }
  return headers;
}
