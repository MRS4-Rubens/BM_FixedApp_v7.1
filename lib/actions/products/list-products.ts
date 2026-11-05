'use server';

import { and, asc, desc, eq, ilike, like, notLike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '../_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { products, taxRates } from '@/lib/db/schema';
import {
  buildPageSlice,
  decodeCursor,
  type Page,
  type PageCursor,
  pageSizeSchema,
} from '@/lib/pagination/keyset';
import { buildContainsPattern, normalizeSearchTerm } from '@/lib/pagination/search';

const listProductsSchema = z
  .object({
    search: z.string().max(100).optional(),
    q: z.string().max(100).optional(),
    includeInactive: z.boolean().optional().default(false),
    kind: z.enum(['all', 'product', 'service']).default('all'),
    limit: pageSizeSchema,
    after: z.string().max(512).optional(),
    before: z.string().max(512).optional(),
  })
  .refine((data) => !(data.after && data.before), {
    message: 'Cannot provide both after and before cursors',
  });

export type ProductRow = typeof products.$inferSelect;
export type TaxRateRow = typeof taxRates.$inferSelect;

export interface ProductListItem {
  readonly product: ProductRow;
  readonly taxRate: TaxRateRow | null;
}

export const listProducts = createAuthenticatedAction(
  listProductsSchema,
  async (data, { appUser }): Promise<Page<ProductListItem>> => {
    if (!appUser.business_id) {
      throw new ActionError('Please complete your business profile in Settings before viewing products.', {
        code: 'NOT_FOUND',
      });
    }

    const baseFilterConditions = [eq(products.business_id, appUser.business_id)];

    if (!data.includeInactive) {
      baseFilterConditions.push(eq(products.is_active, true));
    }

    if (data.kind === 'service') {
      baseFilterConditions.push(like(products.hsn_sac_code, '99%'));
    } else if (data.kind === 'product') {
      baseFilterConditions.push(or(notLike(products.hsn_sac_code, '99%'), sql`${products.hsn_sac_code} IS NULL`)!);
    }

    const searchTerm = normalizeSearchTerm(data.q ?? data.search);
    if (searchTerm) {
      const pattern = buildContainsPattern(searchTerm);
      baseFilterConditions.push(
        or(ilike(products.name, pattern), ilike(products.hsn_sac_code, pattern))!,
      );
    }

    // Keyset conditions (name ASC, id ASC)
    const queryConditions = [...baseFilterConditions];
    const afterCursor = data.after ? decodeCursor(data.after) : null;
    const beforeCursor = data.before ? decodeCursor(data.before) : null;

    const isBackward = Boolean(beforeCursor && beforeCursor.k === 'name');
    const activeCursor = isBackward ? beforeCursor : afterCursor;
    const hasCursor = Boolean(activeCursor && activeCursor.k === 'name');

    if (activeCursor && activeCursor.k === 'name') {
      if (isBackward) {
        queryConditions.push(
          sql`(${products.name}, ${products.id}) < (${activeCursor.t}, ${activeCursor.id}::uuid)`,
        );
      } else {
        queryConditions.push(
          sql`(${products.name}, ${products.id}) > (${activeCursor.t}, ${activeCursor.id}::uuid)`,
        );
      }
    }

    const orderBy = isBackward
      ? [desc(products.name), desc(products.id)]
      : [asc(products.name), asc(products.id)];

    const limitPlusOne = data.limit + 1;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          product: products,
          taxRate: taxRates,
        })
        .from(products)
        .leftJoin(taxRates, eq(products.default_tax_rate_id, taxRates.id))
        .where(and(...queryConditions))
        .orderBy(...orderBy)
        .limit(limitPlusOne),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(...baseFilterConditions)),
    ]);

    const total = countResult[0]?.count ?? 0;

    const slice = buildPageSlice(rows, {
      limit: data.limit,
      direction: isBackward ? 'backward' : 'forward',
      hasCursor,
      toCursor: (row): PageCursor => ({
        v: 1,
        k: 'name',
        t: row.product.name,
        id: row.product.id,
      }),
    });

    return {
      items: slice.rows,
      pageInfo: slice.pageInfo,
      total,
      totalCount: total,
    };
  },
  'list-products',
);
