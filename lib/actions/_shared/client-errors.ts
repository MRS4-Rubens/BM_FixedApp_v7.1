/**
 * BUG-05: shown when a server action call THROWS instead of returning a result — a dropped network, or an old tab
 * after a redeploy ("Server Action not found"). Client-safe (no imports).
 */
export const SERVER_UNREACHABLE_MESSAGE = 'Could not reach the server. Please reload the page and try again.';
