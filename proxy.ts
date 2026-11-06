import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/server';
import { isServerActionRequest } from '@/lib/auth/proxy-policy';

// REMINDER FOR FUTURE PHASES: this matcher is an explicit allowlist, not an auto-protect-everything rule. Any brand-new top-level page added under app/(app)/ or app/(admin)/ in a later phase must have its path prefix added to this array, or it will NOT be protected. This is a deliberate, documented trade-off — Neon Auth's middleware helper does not support a 'protect everything except public pages' mode. Note: tests/unit/proxy-policy.test.ts now fails CI if a top-level folder under app/(app) or app/(admin) is missing from the matcher, or if the matcher lists a prefix with no folder.
const protectRoute = auth.middleware({ loginUrl: '/login' });

export default async function proxy(request: NextRequest) {
  // AUTH-005: only genuine Server Action POSTs skip the auth middleware (running it on them rewrites the
  // session cookie mid-response and corrupts the action response). The action itself still enforces the
  // session via createAuthenticatedAction. A spoofed `next-action` header on a page GET (or any other
  // method/content type) no longer bypasses the login redirect.
  if (isServerActionRequest(request)) {
    return NextResponse.next();
  }
  return protectRoute(request);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/invoices/:path*',
    '/credit-notes/:path*',
    '/customers/:path*',
    '/products/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/checkout/:path*',
    '/dev-boundary-test/:path*',
    '/admin/:path*',
  ],
};
