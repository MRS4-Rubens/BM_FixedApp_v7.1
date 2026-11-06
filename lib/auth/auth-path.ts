export type AuthRouteKind = 'login' | 'signup' | 'recovery';

// Table-driven: first path segment after /api/auth/.
const SEGMENT_KIND: Readonly<Record<string, AuthRouteKind>> = {
  'sign-in': 'login',
  'sign-up': 'signup',
  'forget-password': 'recovery',
  'forgot-password': 'recovery',
  'request-password-reset': 'recovery',
  'reset-password': 'recovery',
  'send-verification-email': 'recovery',
  'send-verification': 'recovery',
  'verify-email': 'recovery',
  'email-otp': 'recovery',
};

/** Only state-changing (POST) calls are classified; session reads (`get-session`), sign-out, callbacks etc. return null. */
export function classifyAuthRoute(method: string, pathname: string): AuthRouteKind | null {
  if (method.toUpperCase() !== 'POST') return null;
  const match = /^\/api\/auth\/([^/?#]+)/i.exec(pathname);
  if (!match) return null;
  const segment = match[1]?.toLowerCase();
  if (segment === undefined) return null;
  return Object.prototype.hasOwnProperty.call(SEGMENT_KIND, segment) ? SEGMENT_KIND[segment] ?? null : null;
}

