/**
 * Server components only: the request's render time, captured once per request on the server and passed
 * to client components as a prop so server and browser render identical values (no hydration mismatch).
 * Never call from client components.
 */
export function getRequestTimeMs(): number {
  return Date.now();
}

