'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { lockBusinessRow } from '@/lib/actions/_shared/business-lock';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { rupeesToPaise } from '@/lib/money';
import { canAddProduct, getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { productSchema } from '@/lib/validations/product';

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unexpected aggregate value while counting products.');
  }
  return parsed;
}

export const createProduct = createAuthenticatedAction(
  productSchema,
  async (data, { appUser }) => {
    const businessId = appUser.business_id;
    if (!businessId) {
      throw new ActionError('Please complete your business profile in Settings before adding products.', { code: 'NOT_FOUND' });
    }

    const { default_sale_price, default_tax_rate_id, stock_quantity, ...rest } = data;

    let insertedProduct: typeof products.$inferSelect;
    try {
      insertedProduct = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessRow(tx, businessId);
          if (getPlanEntitlements(business).productLimit !== null) {
            const [row] = await tx
              .select({ total: sql<string | number>`count(*)` })
              .from(products)
              .where(eq(products.business_id, businessId));
            const currentCount = toCount(row?.total);
            const quotaCheck = canAddProduct(business, currentCount);
            if (!quotaCheck.allowed) {
              throw new ActionError(quotaCheck.reason ?? 'Product quota exceeded.', {
                code: quotaCheck.code ?? 'PRODUCT_QUOTA_EXCEEDED',
              });
            }
          }

          const [inserted] = await tx
            .insert(products)
            .values({
              ...rest,
              business_id: businessId,
              default_sale_price_paise: rupeesToPaise(default_sale_price),
              default_tax_rate_id: default_tax_rate_id === '' ? null : default_tax_rate_id,
              stock_quantity: stock_quantity === '' || stock_quantity === undefined ? null : stock_quantity,
            })
            .returning();

          if (!inserted) {
            throw new ActionError('Failed to save product.', { code: 'INSERT_FAILED' });
          }

          return inserted;
        }),
      );
    } catch (error: unknown) {
      throw toThrowable(error);
    }

    revalidatePath('/products');

    return insertedProduct;
  },
  'create-product',
  { roles: EDITOR_ROLES, requireActiveSubscription: true },
);
