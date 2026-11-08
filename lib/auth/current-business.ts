import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { getCurrentAppUser } from '@/lib/auth/session';

export type CurrentBusiness = typeof businesses.$inferSelect;

/** PERF-004: request-scoped (render pass) full business row of the signed-in user, or null when the user has no business. Fresh in actions/route handlers. */
export const getCurrentBusiness = cache(async (): Promise<CurrentBusiness | null> => {
  const user = await getCurrentAppUser();
  if (!user.business_id) return null;
  const [row] = await db.select().from(businesses).where(eq(businesses.id, user.business_id)).limit(1);
  return row ?? null;
});

