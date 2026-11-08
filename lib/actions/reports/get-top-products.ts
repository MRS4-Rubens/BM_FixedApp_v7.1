'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems, products, creditNotes, creditNoteLineItems } from '@/lib/db/schema';
import { eq, and, between, sql } from 'drizzle-orm';
import { z } from 'zod';

const getTopProductsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  limit: z.number().default(10)
});

export const getTopProducts = createAuthenticatedAction(getTopProductsSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) {
    throw new ActionError('Your account is not linked to a business profile.', {
      code: 'NO_BUSINESS_LINKED',
    });
  }

  const [invoiceResults, cnRows] = await Promise.all([
    db
      .select({
        product_id: invoiceLineItems.product_id,
        description: invoiceLineItems.description,
        product_name: sql<string>`coalesce(${products.name}, ${invoiceLineItems.description}, 'Ad-hoc / Other Items')`,
        hsn_sac_code: invoiceLineItems.hsn_sac_code,
        total_revenue_paise: sql<number>`coalesce(sum(${invoiceLineItems.line_total_paise}), 0)::bigint`.mapWith(Number),
        total_quantity: sql<number>`coalesce(sum(${invoiceLineItems.quantity}::numeric), 0)`.mapWith(Number),
      })
      .from(invoiceLineItems)
      .innerJoin(invoices, eq(invoiceLineItems.invoice_id, invoices.id))
      .leftJoin(products, and(eq(invoiceLineItems.product_id, products.id), eq(products.business_id, invoices.business_id)))
      .where(
        and(
          eq(invoices.business_id, businessId),
          eq(invoices.lifecycle_status, 'finalized'),
          between(invoices.invoice_date, input.startDate, input.endDate)
        )
      )
      .groupBy(
        invoiceLineItems.product_id,
        products.name,
        invoiceLineItems.description,
        invoiceLineItems.hsn_sac_code
      ),

    db
      .select({
        product_id: sql<string | null>`coalesce(${creditNoteLineItems.product_id}, ${invoiceLineItems.product_id})`,
        description: creditNoteLineItems.description,
        hsn_sac_code: creditNoteLineItems.hsn_sac_code,
        total_revenue_paise: sql<number>`coalesce(sum(${creditNoteLineItems.line_total_paise}), 0)::bigint`.mapWith(Number),
        total_quantity: sql<number>`coalesce(sum(${creditNoteLineItems.quantity}::numeric), 0)`.mapWith(Number),
      })
      .from(creditNoteLineItems)
      .innerJoin(creditNotes, eq(creditNoteLineItems.credit_note_id, creditNotes.id))
      .leftJoin(
        invoiceLineItems,
        and(
          eq(invoiceLineItems.invoice_id, creditNotes.original_invoice_id),
          eq(invoiceLineItems.description, creditNoteLineItems.description),
          eq(invoiceLineItems.hsn_sac_code, creditNoteLineItems.hsn_sac_code)
        )
      )
      .where(
        and(
          eq(creditNotes.business_id, businessId),
          eq(creditNotes.lifecycle_status, 'finalized'),
          eq(creditNotes.status, 'active'),
          between(creditNotes.issue_date, input.startDate, input.endDate)
        )
      )
      .groupBy(
        sql`coalesce(${creditNoteLineItems.product_id}, ${invoiceLineItems.product_id})`,
        creditNoteLineItems.description,
        creditNoteLineItems.hsn_sac_code
      ),
  ]);

  const norm = (str: string | null | undefined) => (str || '').trim().toLowerCase();
  const prodKey = (prodId: string | null, desc: string, hsn: string) =>
    prodId ? `prod:${prodId}` : `desc:${norm(desc)}::${norm(hsn)}`;

  const cnMap = new Map<string, { revenue: number; qty: number }>();
  for (const cn of cnRows) {
    const k = prodKey(cn.product_id, cn.description, cn.hsn_sac_code);
    const existing = cnMap.get(k) || { revenue: 0, qty: 0 };
    existing.revenue += cn.total_revenue_paise;
    existing.qty += cn.total_quantity;
    cnMap.set(k, existing);

    // Fallback key by normalized description::hsn_sac_code if product_id was matched
    const descK = `desc:${norm(cn.description)}::${norm(cn.hsn_sac_code)}`;
    if (k !== descK && !cnMap.has(descK)) {
      cnMap.set(descK, { revenue: cn.total_revenue_paise, qty: cn.total_quantity });
    }
  }

  const netResults = invoiceResults
    .map((row) => {
      const k = prodKey(row.product_id, row.description, row.hsn_sac_code);
      const descK = `desc:${norm(row.description)}::${norm(row.hsn_sac_code)}`;
      const credited = cnMap.get(k) || cnMap.get(descK) || { revenue: 0, qty: 0 };
      return {
        product_id: row.product_id,
        product_name: row.product_name || 'Ad-hoc / Other Items',
        hsn_sac_code: row.hsn_sac_code,
        total_revenue_paise: Math.max(0, row.total_revenue_paise - credited.revenue),
        total_quantity: Math.max(0, row.total_quantity - credited.qty),
      };
    })
    .filter((p) => p.total_revenue_paise > 0 && p.total_quantity > 0);

  netResults.sort((a, b) => b.total_revenue_paise - a.total_revenue_paise);

  return netResults.slice(0, input.limit);
}, 'get-top-products');
