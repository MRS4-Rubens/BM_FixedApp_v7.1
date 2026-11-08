'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices, customers, creditNotes } from '@/lib/db/schema';
import { eq, and, between, sql } from 'drizzle-orm';
import { z } from 'zod';

const getTopCustomersSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  limit: z.number().default(10)
});

export const getTopCustomers = createAuthenticatedAction(getTopCustomersSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) {
    throw new ActionError('Your account is not linked to a business profile.', {
      code: 'NO_BUSINESS_LINKED',
    });
  }

  const [invoiceRows, cnRows] = await Promise.all([
    db
      .select({
        customer_id: invoices.customer_id,
        customer_name: sql<string>`coalesce(${customers.name}, ${invoices.billing_name_snapshot}, 'One-Time Customer')`,
        customer_gstin: sql<string | null>`coalesce(${customers.gstin}, ${invoices.billing_gstin_snapshot})`,
        billing_name: invoices.billing_name_snapshot,
        total_revenue_paise: sql<number>`coalesce(sum(${invoices.grand_total_paise}), 0)::bigint`.mapWith(Number),
      })
      .from(invoices)
      .leftJoin(customers, and(eq(invoices.customer_id, customers.id), eq(customers.business_id, invoices.business_id)))
      .where(
        and(
          eq(invoices.business_id, businessId),
          eq(invoices.lifecycle_status, 'finalized'),
          between(invoices.invoice_date, input.startDate, input.endDate)
        )
      )
      .groupBy(
        invoices.customer_id,
        customers.name,
        customers.gstin,
        invoices.billing_name_snapshot,
        invoices.billing_gstin_snapshot
      ),

    db
      .select({
        customer_id: invoices.customer_id,
        billing_name: invoices.billing_name_snapshot,
        total_credited_paise: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`.mapWith(Number),
      })
      .from(creditNotes)
      .innerJoin(invoices, eq(creditNotes.original_invoice_id, invoices.id))
      .where(
        and(
          eq(creditNotes.business_id, businessId),
          eq(creditNotes.lifecycle_status, 'finalized'),
          eq(creditNotes.status, 'active'),
          between(creditNotes.issue_date, input.startDate, input.endDate)
        )
      )
      .groupBy(invoices.customer_id, invoices.billing_name_snapshot),
  ]);

  const cnKey = (customerId: string | null, name: string | null) =>
    customerId ?? `name:${name || ''}`;

  const cnMap = new Map<string, number>();
  for (const cn of cnRows) {
    const k = cnKey(cn.customer_id, cn.billing_name);
    cnMap.set(k, (cnMap.get(k) ?? 0) + cn.total_credited_paise);
  }

  const netResults = invoiceRows
    .map((inv) => {
      const k = cnKey(inv.customer_id, inv.billing_name);
      const credited = cnMap.get(k) ?? 0;
      return {
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        customer_gstin: inv.customer_gstin,
        total_revenue_paise: Math.max(0, inv.total_revenue_paise - credited),
      };
    })
    .filter((c) => c.total_revenue_paise > 0);

  netResults.sort((a, b) => b.total_revenue_paise - a.total_revenue_paise);

  return netResults.slice(0, input.limit);
}, 'get-top-customers');

