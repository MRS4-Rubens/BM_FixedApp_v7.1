'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { loadCreditContext } from '@/lib/actions/_shared/credit-note-context';
import { ActionError } from '@/lib/actions/_shared/errors';
import { CreditNoteRuleError } from '@/lib/credit-notes/derivation';
import { db } from '@/lib/db/client';
import { businesses, invoices } from '@/lib/db/schema';

const getCreditNoteFormDataSchema = z
  .object({
    invoiceId: z.string().uuid('Valid invoice ID is required'),
    creditNoteId: z.string().uuid().optional(),
  })
  .strict();

export const getCreditNoteFormData = createAuthenticatedAction(
  getCreditNoteFormDataSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    // 1. Fetch original invoice (business-scoped)
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

    // 2. Fetch business profile
    const businessRows = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (businessRows.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
    const business = businessRows[0];

    try {
      const ctx = await loadCreditContext(db, {
        businessId,
        invoiceId: originalInvoice.id,
        excludeCreditNoteId: input.creditNoteId,
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
        lineStates: Array.from(ctx.states.values()),
        previouslyCreditedPaise: ctx.otherCreditNotesGrandPaise,
        previouslyCreditedExactPaise: ctx.otherCreditNotesExactPaise,
        invoiceExactTotalPaise: ctx.invoiceExactTotalPaise,
        business: {
          id: business.id,
          legal_name: business.legal_name,
          trade_name: business.trade_name,
          gstin: business.gstin,
          state_code: business.state_code,
        },
        creditNoteFormat: business.credit_note_number_prefix,
      };
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      if (error instanceof CreditNoteRuleError) throw new ActionError(error.message, { code: error.code });
      throw error;
    }
  },
  'get-credit-note-form-data',
);
