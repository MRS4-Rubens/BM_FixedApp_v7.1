'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems, creditNotes, creditNoteLineItems, businesses, taxRates } from '@/lib/db/schema';
import { eq, and, sql, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';

const getCreditNoteFormDataSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID is required'),
  creditNoteId: z.string().uuid().optional(),
});

export const getCreditNoteFormData = createAuthenticatedAction(
  getCreditNoteFormDataSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    // 1. Fetch original invoice
    const invoiceRows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.business_id, businessId)));

    if (invoiceRows.length === 0) {
      throw new ActionError('Original invoice not found.', { code: 'NOT_FOUND' });
    }

    const originalInvoice = invoiceRows[0];

    if (originalInvoice.lifecycle_status !== 'finalized') {
      throw new ActionError('Credit notes can only be issued against finalized invoices.', { code: 'INVALID_STATUS' });
    }

    // 2. Fetch business & tax rates
    const businessRows = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (businessRows.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
    const business = businessRows[0];

    const activeTaxRates = await db.select().from(taxRates).where(eq(taxRates.is_active, true));

    // 3. Fetch original line items
    const origItems = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoice_id, originalInvoice.id))
      .orderBy(invoiceLineItems.sort_order);

    // Aggregate original items by description+hsn key
    const origAggMap = new Map<
      string,
      {
        description: string;
        hsn_sac_code: string;
        unit_of_measurement: string | null;
        totalQuantity: number;
        unit_price_paise: number;
        tax_rate_percentage: string;
      }
    >();

    for (const item of origItems) {
      const key = `${item.description}::${item.hsn_sac_code}`;
      const qty = parseFloat(item.quantity) || 0;
      const existing = origAggMap.get(key);
      if (existing) {
        existing.totalQuantity = Math.round((existing.totalQuantity + qty) * 100) / 100;
      } else {
        origAggMap.set(key, {
          description: item.description,
          hsn_sac_code: item.hsn_sac_code,
          unit_of_measurement: item.unit_of_measurement,
          totalQuantity: qty,
          unit_price_paise: item.unit_price_paise,
          tax_rate_percentage: item.tax_rate_percentage,
        });
      }
    }

    // Fetch all non-voided credit notes for this invoice (excluding current draft if editing)
    const otherCreditNotes = await db
      .select({ id: creditNotes.id })
      .from(creditNotes)
      .where(
        and(
          eq(creditNotes.business_id, business.id),
          eq(creditNotes.original_invoice_id, originalInvoice.id),
          ne(creditNotes.status, 'voided'),
          input.creditNoteId ? ne(creditNotes.id, input.creditNoteId) : undefined
        )
      );

    const creditedQtyMap = new Map<string, number>();

    if (otherCreditNotes.length > 0) {
      const otherIds = otherCreditNotes.map((cn) => cn.id);
      const otherLineItems = await db
        .select()
        .from(creditNoteLineItems)
        .where(inArray(creditNoteLineItems.credit_note_id, otherIds));

      for (const li of otherLineItems) {
        const key = `${li.description}::${li.hsn_sac_code}`;
        const current = creditedQtyMap.get(key) ?? 0;
        creditedQtyMap.set(key, current + (parseFloat(li.quantity) || 0));
      }
    }

    // Build available items with remaining creditable quantities
    const availableItems = [];
    for (const [key, item] of origAggMap.entries()) {
      const creditedQty = creditedQtyMap.get(key) ?? 0;
      const remainingQty = Math.max(
        0,
        Math.round((item.totalQuantity - creditedQty) * 100) / 100
      );

      if (remainingQty > 0 || input.creditNoteId) {
        availableItems.push({
          description: item.description,
          hsn_sac_code: item.hsn_sac_code,
          unit_of_measurement: item.unit_of_measurement ?? 'NOS',
          max_quantity: remainingQty,
          unit_price_rupees: item.unit_price_paise / 100,
          tax_rate_percentage: Number(item.tax_rate_percentage),
        });
      }
    }

    // Fetch total amount already credited across non-voided credit notes for this invoice
    const existingCnSumRes = await db
      .select({ total: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)` })
      .from(creditNotes)
      .where(
        and(
          eq(creditNotes.business_id, business.id),
          eq(creditNotes.original_invoice_id, originalInvoice.id),
          ne(creditNotes.status, 'voided'),
          input.creditNoteId ? ne(creditNotes.id, input.creditNoteId) : undefined
        )
      );
    const previouslyCreditedPaise = Number(existingCnSumRes[0]?.total || 0);

    const preparedLineItems = Array.from(origAggMap.entries()).map(([key, item]) => {
      const creditedQty = creditedQtyMap.get(key) ?? 0;
      const remainingQty = Math.max(
        0,
        Math.round((item.totalQuantity - creditedQty) * 100) / 100
      );

      const matchedTaxRate = activeTaxRates.find(
        (tr) => Number(tr.rate_percentage) === Number(item.tax_rate_percentage)
      ) || activeTaxRates[0];

      return {
        id: key,
        product_id: null as string | null,
        description: item.description,
        hsn_sac_code: item.hsn_sac_code,
        unit_of_measurement: item.unit_of_measurement ?? 'NOS',
        unit_price_paise: item.unit_price_paise,
        unit_price_rupees: item.unit_price_paise / 100,
        discount_percentage: 0,
        tax_rate_percentage: Number(item.tax_rate_percentage),
        tax_rate_id: matchedTaxRate ? matchedTaxRate.id : '',
        original_quantity: item.totalQuantity,
        already_credited_quantity: creditedQty,
        remaining_creditable_quantity: remainingQty,
        max_quantity: remainingQty,
      };
    });

    const originalInvoiceData = {
      id: originalInvoice.id,
      invoice_number: originalInvoice.invoice_number,
      invoice_date: originalInvoice.invoice_date,
      customer_name: originalInvoice.billing_name_snapshot ?? '',
      billing_name: originalInvoice.billing_name_snapshot,
      recipient_gstin: originalInvoice.billing_gstin_snapshot,
      billing_gstin: originalInvoice.billing_gstin_snapshot,
      place_of_supply_state_code: originalInvoice.place_of_supply_state_code ?? business.state_code,
      supplier_state_code: business.state_code,
      gst_rate_type: (
        originalInvoice.gst_rate_type === 'inclusive' ? 'inclusive' : 'exclusive'
      ) as 'inclusive' | 'exclusive',
      grand_total_paise: originalInvoice.grand_total_paise,
      subtotal_paise: originalInvoice.subtotal_paise,
      total_tax_paise: originalInvoice.total_tax_paise,
    };

    return {
      originalInvoice: originalInvoiceData,
      invoice: originalInvoiceData,
      availableItems,
      lineItems: preparedLineItems,
      previouslyCreditedPaise,
      business: {
        id: business.id,
        legal_name: business.legal_name,
        trade_name: business.trade_name,
        gstin: business.gstin,
        state_code: business.state_code,
      },
      taxRates: activeTaxRates,
      creditNoteFormat: business.credit_note_number_prefix,
    };
  },
  'get-credit-note-form-data'
);
