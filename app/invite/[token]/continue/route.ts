import { NextResponse, type NextRequest } from 'next/server';
import { isWellFormedInviteToken } from '@/lib/team/invite-format';
import { PENDING_INVITE_COOKIE, PENDING_INVITE_COOKIE_OPTIONS } from '@/lib/team/pending-invite-cookie';

/**
 * Feature A: a signed-out invitee chose "Log in" or "Create account" on the invite page. Remember the invite in
 * an httpOnly cookie, then open the normal sign-in / sign-up modal. After signing in, the login and sign-up
 * actions send the person back to /invite/<token>. Only the token's SHAPE is checked here; the invite page and
 * the accept action do the real checks.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const mode = request.nextUrl.searchParams.get('mode') === 'signup' ? 'signup' : 'login';

  if (!isWellFormedInviteToken(token)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const response = NextResponse.redirect(new URL(`/?auth=${mode}`, request.url));
  response.cookies.set(PENDING_INVITE_COOKIE, token, PENDING_INVITE_COOKIE_OPTIONS);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
