'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { users, businesses } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

export const getAllUsers = createAuthenticatedAction(
  z.object({}),
  async () => {
    // Query users with their business names (left join)
    const results = await db
      .select({
        id: users.id,
        displayName: users.display_name,
        email: users.email,
        role: users.role,
        createdAt: users.created_at,
        businessId: users.business_id,
        businessName: businesses.legal_name,
      })
      .from(users)
      .leftJoin(businesses, eq(users.business_id, businesses.id))
      .orderBy(desc(users.created_at));

    return results;
  },
  'get-all-users',
  { requirePlatformAdmin: true }
);
