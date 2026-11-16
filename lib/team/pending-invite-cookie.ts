import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { INVITE_TTL_DAYS, buildInvitePath, isWellFormedInviteToken } from '@/lib/team/invite-format';

/**
 * Remembers an invite across sign-in / sign-up (feature A). Set when a signed-out person continues from the
 * invite page (app/invite/[token]/continue); used by the login and sign-up actions to land back on
 * /invite/<token> instead of /dashboard. httpOnly (not readable by page scripts), SameSite=Lax, Secure in production.
 *
 * ONE-SHOT: taking it deletes it, and it is only honoured while the invite is still pending and unexpired.
 * Otherwise a cancelled, used or ignored invite would hijack every later login for up to 7 days.
 */
export const PENDING_INVITE_COOKIE = 'bm_pending_invite';

export const PENDING_INVITE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: INVITE_TTL_DAYS * 24 * 60 * 60,
};

/** For Server Actions only (they may write cookies). Returns `/invite/<token>` or null. Never throws. */
export async function takePendingInvitePath(): Promise<string | null> {
  try {
    const jar = await cookies();
    const value = jar.get(PENDING_INVITE_COOKIE)?.value;
    if (value === undefined) return null;
    jar.delete(PENDING_INVITE_COOKIE);
    if (!isWellFormedInviteToken(value)) return null;

    const [{ db }, { businessInvitations }, { hashInviteToken }] = await Promise.all([
      import('@/lib/db/client'),
      import('@/lib/db/schema'),
      import('@/lib/team/invite-token'),
    ]);
    const [open] = await db
      .select({ id: businessInvitations.id })
      .from(businessInvitations)
      .where(
        and(
          eq(businessInvitations.token_hash, hashInviteToken(value)),
          eq(businessInvitations.status, 'pending'),
          gt(businessInvitations.expires_at, new Date()),
        ),
      )
      .limit(1);
    return open ? buildInvitePath(value) : null;
  } catch {
    return null;
  }
}

export async function clearPendingInviteCookie(): Promise<void> {
  try {
    (await cookies()).delete(PENDING_INVITE_COOKIE);
  } catch {
    // Not in a request scope that can write cookies: nothing to clear.
  }
}
