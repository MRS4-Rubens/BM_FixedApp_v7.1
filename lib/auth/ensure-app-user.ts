import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { logError } from '@/lib/actions/_shared/logger';

export type AppUser = typeof users.$inferSelect;
export interface EnsureAppUserInput {
  authUserId: string;
  displayName?: string | null;
  email?: string | null;
}

/** Idempotent, race-safe provisioning: INSERT … ON CONFLICT DO NOTHING, then read. Real DB errors are logged and re-thrown. */
export async function ensureAppUser(input: EnsureAppUserInput): Promise<AppUser> {
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        auth_user_id: input.authUserId,
        email: input.email ?? null,
        role: 'owner',
        display_name: input.displayName ?? null,
        business_id: null,
      })
      .onConflictDoNothing({ target: users.auth_user_id })
      .returning();
    if (inserted) return inserted;

    const [existing] = await db.select().from(users).where(eq(users.auth_user_id, input.authUserId)).limit(1);
    if (!existing) {
      throw new Error('ensureAppUser: users row missing after conflict-free insert');
    }
    if (input.email && !existing.email) {
      const [updated] = await db
        .update(users)
        .set({ email: input.email, updated_at: new Date() })
        .where(and(eq(users.id, existing.id), isNull(users.email)))
        .returning();
      return updated ?? existing;
    }
    return existing;
  } catch (error: unknown) {
    logError('ensure-app-user', error, { authUserId: input.authUserId });
    throw error;
  }
}
