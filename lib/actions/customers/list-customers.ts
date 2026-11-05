'use server';

import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import {
  buildPageSlice,
  decodeCursor,
  type Page,
  type PageCursor,
  pageSizeSchema,
} from '@/lib/pagination/keyset';
import { buildContainsPattern, normalizeSearchTerm } from '@/lib/pagination/search';

const listCustomersSchema = z
  .object({
    search: z.string().max(100).optional(),
    q: z.string().max(100).optional(),
    includeInactive: z.boolean().default(false),
    limit: pageSizeSchema,
    after: z.string().max(512).optional(),
    before: z.string().max(512).optional(),
  })
  .refine((data) => !(data.after && data.before), {
    message: 'Cannot provide both after and before cursors',
  });

export type CustomerRow = typeof customers.$inferSelect;

export const listCustomers = createAuthenticatedAction(
  listCustomersSchema,
  async (input, context): Promise<Page<CustomerRow>> => {
    const businessId = context.appUser.business_id;

    if (!businessId) {
      throw new ActionError('Please complete your business profile in Settings before viewing customers.', {
        code: 'NOT_FOUND',
      });
    }

    const baseFilterConditions = [eq(customers.business_id, businessId)];

    if (!input.includeInactive) {
      baseFilterConditions.push(eq(customers.is_active, true));
    }

    const searchTerm = normalizeSearchTerm(input.q ?? input.search);
    if (searchTerm) {
      const pattern = buildContainsPattern(searchTerm);
      baseFilterConditions.push(
        or(
          ilike(customers.name, pattern),
          ilike(customers.gstin, pattern),
          ilike(customers.phone, pattern),
          ilike(customers.email, pattern),
        )!,
      );
    }

    // Keyset conditions (name ASC, id ASC)
    const queryConditions = [...baseFilterConditions];
    const afterCursor = input.after ? decodeCursor(input.after) : null;
    const beforeCursor = input.before ? decodeCursor(input.before) : null;

    const isBackward = Boolean(beforeCursor && beforeCursor.k === 'name');
    const activeCursor = isBackward ? beforeCursor : afterCursor;
    const hasCursor = Boolean(activeCursor && activeCursor.k === 'name');

    if (activeCursor && activeCursor.k === 'name') {
      if (isBackward) {
        queryConditions.push(
          sql`(${customers.name}, ${customers.id}) < (${activeCursor.t}, ${activeCursor.id}::uuid)`,
        );
      } else {
        queryConditions.push(
          sql`(${customers.name}, ${customers.id}) > (${activeCursor.t}, ${activeCursor.id}::uuid)`,
        );
      }
    }

    const orderBy = isBackward
      ? [desc(customers.name), desc(customers.id)]
      : [asc(customers.name), asc(customers.id)];

    const limitPlusOne = input.limit + 1;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(and(...queryConditions))
        .orderBy(...orderBy)
        .limit(limitPlusOne),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(...baseFilterConditions)),
    ]);

    const total = countResult[0]?.count ?? 0;

    const slice = buildPageSlice(rows, {
      limit: input.limit,
      direction: isBackward ? 'backward' : 'forward',
      hasCursor,
      toCursor: (row): PageCursor => ({
        v: 1,
        k: 'name',
        t: row.name,
        id: row.id,
      }),
    });

    return {
      items: slice.rows,
      pageInfo: slice.pageInfo,
      total,
      totalCount: total,
    };
  },
  'list-customers',
);
