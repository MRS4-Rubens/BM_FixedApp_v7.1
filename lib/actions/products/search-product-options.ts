'use server';

import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import type { ProductOption } from '@/lib/pickers/types';
import { buildContainsPattern, buildPrefixPattern } from '@/lib/pagination/search';

const searchProductOptionsSchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(8),
}).strict();

export const searchProductOptions = createAuthenticatedAction(
  searchProductOptionsSchema,
  async (input, context): Promise<ProductOption[]> => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      return [];
    }

    const prefixPattern = buildPrefixPattern(input.q);
    const containsPattern = buildContainsPattern(input.q);

    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        hsn_sac_code: products.hsn_sac_code,
        unit_of_measurement: products.unit_of_measurement,
        default_sale_price_paise: products.default_sale_price_paise,
        default_tax_rate_id: products.default_tax_rate_id,
      })
      .from(products)
      .where(
        and(
          eq(products.business_id, businessId),
          eq(products.is_active, true),
          or(
            ilike(products.name, containsPattern),
            ilike(products.hsn_sac_code, containsPattern),
          ),
        ),
      )
      .orderBy(
        sql`(${products.name} ILIKE ${prefixPattern}) DESC`,
        asc(products.name),
        asc(products.id),
      )
      .limit(input.limit);

    return rows;
  },
  'search-product-options',
);

