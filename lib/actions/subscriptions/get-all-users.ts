'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { users, businesses } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

export const getAllUsers = createAuthenticatedAction(
  z.object({}),
  async () => {
    try {
      // Query users with their business names (left join)
      const results = await db
        .select({
          id: users.id,
          displayName: users.display_name,
          role: users.role,
          createdAt: users.created_at,
          businessId: users.business_id,
          businessName: businesses.legal_name,
        })
        .from(users)
        .leftJoin(businesses, eq(users.business_id, businesses.id))
        .orderBy(desc(users.created_at));

      return results;
    } catch (err: any) {
      console.error('[getAllUsers] Failed to fetch users directory:', err);
      throw new ActionError('Failed to fetch platform users directory.', {
        code: 'FETCH_FAILED',
      });
    }
  },
  'get-all-users',
  { requirePlatformAdmin: true }
);
