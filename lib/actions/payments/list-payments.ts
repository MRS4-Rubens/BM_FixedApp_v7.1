'use server';

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { payments, users } from '@/lib/db/schema';

export const listPayments = createAuthenticatedAction(
  z.object({ invoice_id: z.string().uuid() }),
  async ({ invoice_id }, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', {
        code: 'NO_BUSINESS_LINKED',
      });
    }

    // PERF-001: hard safety cap of 200 payments per invoice to prevent unbounded memory allocation
    const data = await db
      .select({
        id: payments.id,
        business_id: payments.business_id,
        invoice_id: payments.invoice_id,
        amount_paise: payments.amount_paise,
        kind: payments.kind,
        payment_date: payments.payment_date,
        payment_method: payments.payment_method,
        reference_number: payments.reference_number,
        notes: payments.notes,
        status: payments.status,
        voided_at: payments.voided_at,
        voided_by: payments.voided_by,
        void_reason: payments.void_reason,
        void_notes: payments.void_notes,
        created_at: payments.created_at,
        voided_by_name: users.display_name,
      })
      .from(payments)
      .leftJoin(users, eq(payments.voided_by, users.id))
      .where(
        and(
          eq(payments.business_id, businessId),
          eq(payments.invoice_id, invoice_id),
        ),
      )
      .orderBy(desc(payments.payment_date), desc(payments.created_at))
      .limit(200);

    return data;
  },
  'list-payments',
);

export type PaymentListItem = Extract<
  Awaited<ReturnType<typeof listPayments>>,
  { success: true }
>['data'][number];
