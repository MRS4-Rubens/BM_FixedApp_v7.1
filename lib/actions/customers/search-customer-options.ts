'use server';

import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import type { CustomerOption } from '@/lib/pickers/types';
import { buildContainsPattern, buildPrefixPattern } from '@/lib/pagination/search';

const searchCustomerOptionsSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(8),
}).strict();

export const searchCustomerOptions = createAuthenticatedAction(
  searchCustomerOptionsSchema,
  async (input, context): Promise<CustomerOption[]> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      return [];
    }

    const prefixPattern = buildPrefixPattern(input.q);
    const containsPattern = buildContainsPattern(input.q);

    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        gstin: customers.gstin,
        state_code: customers.state_code,
        address_line1: customers.address_line1,
        address_line2: customers.address_line2,
        city: customers.city,
        pincode: customers.pincode,
        phone: customers.phone,
      })
      .from(customers)
      .where(
        and(
          eq(customers.business_id, businessId),
          eq(customers.is_active, true),
          or(
            ilike(customers.name, containsPattern),
            ilike(customers.gstin, containsPattern),
          ),
        ),
      )
      .orderBy(
        sql`(${customers.name} ILIKE ${prefixPattern}) DESC`,
        asc(customers.name),
        asc(customers.id),
      )
      .limit(input.limit);

    return rows;
  },
  'search-customer-options',
);

