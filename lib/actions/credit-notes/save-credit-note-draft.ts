'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { loadCreditContext } from '@/lib/actions/_shared/credit-note-context';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import {
  CreditNoteRuleError,
  deriveCreditLines,
  milliToQuantityString,
  quantityToMilli,
  resolveCreditNoteGrandTotal,
  sumDerivedLines,
} from '@/lib/credit-notes/derivation';
import { db } from '@/lib/db/client';
import { creditNoteLineItems, creditNotes, invoices } from '@/lib/db/schema';
import { setLocalLockTimeout, toBusyActionError } from '@/lib/db/transaction';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { creditNoteDraftSchema } from '@/lib/validations/credit-note';

export const saveCreditNoteDraft = createAuthenticatedAction(
  creditNoteDraftSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
    }

    try {
      return await db.transaction(async (tx) => {
        await setLocalLockTimeout(tx);

        // 1. Lock the original invoice row (tenant-scoped). Serializes every credit-note save/finalize for this
        //    invoice. Lock order: invoice -> credit note -> financial_years/counters.
        const [originalInvoice] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, input.original_invoice_id), eq(invoices.business_id, businessId)))
          .for('update');
        if (!originalInvoice) throw new ActionError('Original invoice not found.', { code: 'NOT_FOUND' });
        if (originalInvoice.lifecycle_status !== 'finalized') {
          throw new ActionError('Credit notes can only be issued against finalized invoices.', { code: 'INVALID_STATUS' });
        }

        // 2. Updating an existing draft: lock it, scoped to this business AND this invoice.
        if (input.id) {
          const [existing] = await tx
            .select()
            .from(creditNotes)
            .where(
              and(
                eq(creditNotes.id, input.id),
                eq(creditNotes.business_id, businessId),
                eq(creditNotes.original_invoice_id, originalInvoice.id),
              ),
            )
            .for('update');
          if (!existing) throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
          if (existing.lifecycle_status !== 'draft') {
            throw new ActionError('This credit note has already been finalized and cannot be edited.', { code: 'ALREADY_FINALIZED' });
          }
        }

        // 3. Authoritative derivation from the ORIGINAL lines (server is the only source of price/tax/HSN/UoM).
        const ctx = await loadCreditContext(tx, {
          businessId,
          invoiceId: originalInvoice.id,
          excludeCreditNoteId: input.id,
        });

        const derivedLines = deriveCreditLines(
          ctx.states,
          input.line_items.map((li) => ({
            originalLineItemId: li.original_line_item_id,
            quantityMilli: quantityToMilli(li.quantity),
          })),
        );

        const totals = sumDerivedLines(derivedLines);
        const grandTotalPaise = resolveCreditNoteGrandTotal({
          exactTotalPaise: totals.exactTotalPaise,
          invoiceGrandTotalPaise: originalInvoice.grand_total_paise,
          invoiceExactTotalPaise: ctx.invoiceExactTotalPaise,
          otherCreditNotesGrandPaise: ctx.otherCreditNotesGrandPaise,
          otherCreditNotesExactPaise: ctx.otherCreditNotesExactPaise,
        });

        // 4. Financial year for the credit-note date.
        const issueDateObj = input.issue_date ? parseIsoDateToIstDate(input.issue_date) : new Date();
        const activeFy = await getOrCreateCurrentFinancialYear(tx, businessId, issueDateObj);

        const cnData = {
          business_id: businessId,
          original_invoice_id: originalInvoice.id,
          financial_year_id: activeFy.id,
          reason: input.reason,
          lifecycle_status: 'draft' as const,
          issue_date: input.issue_date || null,
          subtotal_paise: totals.subtotalPaise,
          total_cgst_paise: totals.totalCgstPaise,
          total_sgst_paise: totals.totalSgstPaise,
          total_igst_paise: totals.totalIgstPaise,
          total_tax_paise: totals.totalTaxPaise,
          grand_total_paise: grandTotalPaise,
        };

        let creditNoteId: string;
        if (input.id) {
          const [updated] = await tx
            .update(creditNotes)
            .set(cnData)
            .where(
              and(
                eq(creditNotes.id, input.id),
                eq(creditNotes.business_id, businessId),
                eq(creditNotes.lifecycle_status, 'draft'),
                eq(creditNotes.status, 'active'),
              ),
            )
            .returning({ id: creditNotes.id });
          if (!updated) {
            throw new ActionError('This credit note has already been finalized and cannot be edited.', { code: 'ALREADY_FINALIZED' });
          }
          creditNoteId = updated.id;
        } else {
          const [created] = await tx
            .insert(creditNotes)
            .values({ ...cnData, credit_note_sequence: null, credit_note_number: `DRAFT-CN-${Date.now()}` })
            .returning({ id: creditNotes.id });
          if (!created) throw new ActionError('Failed to create credit note draft.', { code: 'SAVE_FAILED' });
          creditNoteId = created.id;
        }

        // 5. Replace line items (draft parent => DB-001 guard allows it).
        await tx.delete(creditNoteLineItems).where(eq(creditNoteLineItems.credit_note_id, creditNoteId));
        await tx.insert(creditNoteLineItems).values(
          derivedLines.map((line, idx) => ({
            credit_note_id: creditNoteId,
            original_line_item_id: line.originalLineItemId,
            product_id: line.productId,
            description: line.description,
            hsn_sac_code: line.hsnSacCode,
            quantity: milliToQuantityString(line.quantityMilli),
            unit_of_measurement: line.unitOfMeasurement,
            unit_price_paise: line.unitPricePaise,
            discount_paise: line.discountPaise,
            taxable_value_paise: line.taxableValuePaise,
            tax_rate_percentage: line.taxRatePercentage,
            cgst_paise: line.cgstPaise,
            sgst_paise: line.sgstPaise,
            igst_paise: line.igstPaise,
            line_total_paise: line.lineTotalPaise,
            sort_order: idx,
          })),
        );

        revalidatePath(`/invoices/${originalInvoice.id}`);
        revalidatePath(`/credit-notes/${creditNoteId}`);
        return { id: creditNoteId };
      });
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      if (error instanceof CreditNoteRuleError) throw new ActionError(error.message, { code: error.code });
      const busy = toBusyActionError(error);
      if (busy) throw busy;
      logError('save-credit-note-draft', error, { creditNoteId: input.id });
      throw new ActionError('We could not save the credit note draft. Please try again.', { code: 'SAVE_FAILED' });
    }
  },
  'save-credit-note-draft',
);
