import type { RateLimitOutcome } from '@/lib/rate-limit/enforce';

/**
 * API-01: one error shape for the download / polling routes: JSON `{ error, code }` with `no-store`, so the browser tab
 * (exports are opened as links) shows a readable message and scripts can branch on `code`.
 */
export function jsonError(
  status: number,
  error: string,
  code: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/** HTTP status for an ActionError code returned by a server action called from a route. */
function statusForActionCode(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'NO_BUSINESS_LINKED':
      return 400;
    case 'UNAUTHORIZED':
    case 'NO_APP_USER':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
    case 'BUSINESS_NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'SERVICE_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

/** An action's failure as a JSON response (internal errors keep the generic message the action already produced). */
export function actionErrorResponse(failure: { readonly code: string; readonly message: string }): Response {
  return jsonError(statusForActionCode(failure.code), failure.message, failure.code);
}

/** 429 (too many requests) or 503 (rate-limit store unreachable, fail-closed) with Retry-After. */
export function rateLimitedResponse(
  outcome: Extract<RateLimitOutcome, { allowed: false }>,
): Response {
  const retryAfter = { 'Retry-After': String(outcome.retryAfterSeconds) };
  return outcome.reason === 'limited'
    ? jsonError(429, `Too Many Requests. Retry after ${outcome.retryAfterSeconds} seconds.`, 'RATE_LIMITED', retryAfter)
    : jsonError(503, 'Downloads are briefly unavailable. Please try again in a minute.', 'SERVICE_UNAVAILABLE', retryAfter);
}
