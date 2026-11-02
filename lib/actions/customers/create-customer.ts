'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { lockBusinessRow } from '@/lib/actions/_shared/business-lock';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { CUSTOMER_MAPPINGS } from '@/lib/actions/_shared/pg-constraint-mappings';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { canAddCustomer, getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { customerSchema } from '@/lib/validations/customer';

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unexpected aggregate value while counting customers.');
  }
  return parsed;
}

export const createCustomer = createAuthenticatedAction(
  customerSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;

    if (!businessId) {
      throw new ActionError('Please complete your business profile in Settings before adding customers.', { code: 'NOT_FOUND' });
    }

    const data = {
      business_id: businessId,
      name: input.name,
      gstin: input.gstin || null,
      email: input.email || null,
      phone: input.phone || null,
      address_line1: input.address_line1 || null,
      address_line2: input.address_line2 || null,
      city: input.city || null,
      state_code: input.state_code,
      pincode: input.pincode || null,
    };

    try {
      await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessRow(tx, businessId);
          if (getPlanEntitlements(business).customerLimit !== null) {
            const [row] = await tx
              .select({ total: sql<string | number>`count(*)` })
              .from(customers)
              .where(eq(customers.business_id, businessId));
            const currentCount = toCount(row?.total);
            const quotaCheck = canAddCustomer(business, currentCount);
            if (!quotaCheck.allowed) {
              throw new ActionError(quotaCheck.reason ?? 'Customer quota exceeded.', {
                code: quotaCheck.code ?? 'CUSTOMER_QUOTA_EXCEEDED',
              });
            }
          }
          await tx.insert(customers).values(data);
        }),
      );
    } catch (error: unknown) {
      throw toThrowable(error, CUSTOMER_MAPPINGS);
    }

    revalidatePath('/customers');

    return { success: true };
  },
  'create-customer',
  { requireActiveSubscription: true },
);
