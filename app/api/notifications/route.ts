import { eq } from 'drizzle-orm';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { logError } from '@/lib/actions/_shared/logger';
import { listNotificationsFor } from '@/lib/notifications/list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } as const;

/**
 * Feature C: GET /api/notifications — the signed-in person's own bell items (newest 20) and unread count.
 * A plain route on purpose: the bell polls in the background, and Next.js runs server actions one at a time per
 * tab, so a polling server action could queue in front of the user's real actions (seen in E2E: a refresh landed
 * mid-typing in the payment form). 401 when signed out; an empty list for an account without a business.
 */
export async function GET(): Promise<Response> {
  // API-01: the session lookup is inside the try too (a Neon Auth / database blip is a JSON 500, not a crash).
  try {
    const session = await getRequestSession();
    const authUserId = session?.data?.user?.id;
    if (!authUserId) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), { status: 401, headers: NO_STORE });
    }
    const [me] = await db
      .select({ id: users.id, businessId: users.business_id })
      .from(users)
      .where(eq(users.auth_user_id, authUserId))
      .limit(1);
    if (!me) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), { status: 401, headers: NO_STORE });
    }
    const list = me.businessId ? await listNotificationsFor(me.id, me.businessId) : { items: [], unreadCount: 0 };
    return new Response(JSON.stringify(list), { status: 200, headers: NO_STORE });
  } catch (error: unknown) {
    logError('notifications-list', error, {});
    return new Response(JSON.stringify({ error: 'Could not load notifications.', code: 'INTERNAL_ERROR' }), { status: 500, headers: NO_STORE });
  }
}
