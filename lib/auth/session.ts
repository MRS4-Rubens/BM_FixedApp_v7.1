import { cache } from 'react';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { ensureAppUser, type AppUser } from '@/lib/auth/ensure-app-user';
import { getRequestSession, type GetSessionResult } from '@/lib/auth/request-session';

export type SessionData = NonNullable<NonNullable<GetSessionResult>['data']>;

export async function requireSession(): Promise<SessionData> {
  const sessionResponse = await getRequestSession();
  if (!sessionResponse || !sessionResponse.data || !sessionResponse.data.user) {
    redirect('/login');
  }
  return sessionResponse.data;
}

/**
 * PERF-004: request-scoped (render pass) app user lookup. In Server Actions and Route Handlers,
 * cache() is a pass-through so mutations followed by re-reads always see fresh state.
 * Self-healing: a valid session always yields an app user. Hot path = one SELECT; the row is (re)created only when missing.
 */
export const getCurrentAppUser = cache(async (): Promise<AppUser> => {
  const sessionData = await requireSession();
  const [existing] = await db.select().from(users).where(eq(users.auth_user_id, sessionData.user.id)).limit(1);
  if (existing) {
    if (!existing.email && sessionData.user.email) {
      const [updated] = await db
        .update(users)
        .set({ email: sessionData.user.email, updated_at: new Date() })
        .where(and(eq(users.id, existing.id), isNull(users.email)))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  return ensureAppUser({
    authUserId: sessionData.user.id,
    email: sessionData.user.email ?? null,
    displayName: sessionData.user.name ?? null,
  });
});
