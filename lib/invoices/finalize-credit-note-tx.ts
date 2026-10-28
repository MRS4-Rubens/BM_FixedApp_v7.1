import { and, eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { loadCreditContext } from '@/lib/actions/_shared/credit-note-context';
import type { DbTransaction } from '@/lib/db/client';
import { businesses, creditNoteLineItems, creditNotes } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockDraftCreditNote, lockFinalizedInvoice } from '@/lib/invoices/document-locks';
import { getNextCreditNoteNumber } from '@/lib/invoices/credit-note-numbering';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { formatIstDateAsIso, parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { recomputePaymentStatus } from '@/lib/invoices/payment-status';
import { captureSellerSnapshot } from '@/lib/invoices/seller-snapshot';
import {
  CreditNoteRuleError,
  assertCreditNoteMatchesDerivation,
  deriveCreditLines,
  quantityToMilli,
  resolveCreditNoteGrandTotal,
  sumDerivedLines,
} from '@/lib/credit-notes/derivation';

export interface FinalizeCreditNoteTxParams {
  readonly creditNoteId: string;
  readonly businessId: string;
}

export interface FinalizeCreditNoteTxResult {
  readonly id: string;
  readonly creditNoteNumber: string;
  readonly originalInvoiceId: string;
}

export async function finalizeDraftCreditNoteInTransaction(
  tx: DbTransaction,
  params: FinalizeCreditNoteTxParams,
): Promise<FinalizeCreditNoteTxResult> {
  // 1. Fail-fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. PEEK (no lock) to find the original invoice ID
  const peekRows = await tx
    .select({ original_invoice_id: creditNotes.original_invoice_id })
    .from(creditNotes)
    .where(and(eq(creditNotes.id, params.creditNoteId), eq(creditNotes.business_id, params.businessId)));

  if (peekRows.length === 0) {
    throw new ActionError('Credit note not found.', { code: 'NOT_FOUND' });
  }

  const peekedOriginalInvoiceId = peekRows[0].original_invoice_id;

  // 3. Lock original finalized invoice (Lock order: invoice row first)
  const originalInvoice = await lockFinalizedInvoice(tx, {
    id: peekedOriginalInvoiceId,
    businessId: params.businessId,
  });

  // 4. Lock draft credit note (Lock order: credit note row second)
  const creditNote = await lockDraftCreditNote(tx, {
    id: params.creditNoteId,
    businessId: params.businessId,
  });

  if (creditNote.original_invoice_id !== peekedOriginalInvoiceId) {
    throw new ActionError(
      'This credit note was modified while finalizing. Please review it and try again.',
      { code: 'CONFLICT' },
    );
  }

  // 5. Ensure credit note has line items
  const lineItemRows = await tx
    .select()
    .from(creditNoteLineItems)
    .where(eq(creditNoteLineItems.credit_note_id, creditNote.id));

  if (lineItemRows.length === 0) {
    throw new ActionError('Credit note must contain at least one line item before finalization.', { code: 'NO_ITEMS' });
  }

  // 5b. API-004: Re-validation under lock against fresh derivation
  const ctx = await loadCreditContext(tx, {
    businessId: params.businessId,
    invoiceId: originalInvoice.id,
    excludeCreditNoteId: creditNote.id,
  });

  const derived = deriveCreditLines(
    ctx.states,
    lineItemRows.map((li) => {
      if (li.original_line_item_id === null) {
        throw new CreditNoteRuleError(
          'LEGACY_CREDIT_UNLINKED',
          'This draft was created before item-level validation. Delete it and create a new credit note.',
        );
      }
      return {
        originalLineItemId: li.original_line_item_id,
        quantityMilli: quantityToMilli(li.quantity),
      };
    }),
  );

  const derivedTotals = sumDerivedLines(derived);
  const derivedGrand = resolveCreditNoteGrandTotal({
    exactTotalPaise: derivedTotals.exactTotalPaise,
    invoiceGrandTotalPaise: originalInvoice.grand_total_paise,
    invoiceExactTotalPaise: ctx.invoiceExactTotalPaise,
    otherCreditNotesGrandPaise: ctx.otherCreditNotesGrandPaise,
    otherCreditNotesExactPaise: ctx.otherCreditNotesExactPaise,
  });

  assertCreditNoteMatchesDerivation(
    {
      header: {
        subtotalPaise: creditNote.subtotal_paise,
        totalCgstPaise: creditNote.total_cgst_paise,
        totalSgstPaise: creditNote.total_sgst_paise,
        totalIgstPaise: creditNote.total_igst_paise,
        totalTaxPaise: creditNote.total_tax_paise,
        grandTotalPaise: creditNote.grand_total_paise,
      },
      lines: lineItemRows.map((li) => {
        if (li.original_line_item_id === null) {
          throw new CreditNoteRuleError(
            'LEGACY_CREDIT_UNLINKED',
            'This draft was created before item-level validation. Delete it and create a new credit note.',
          );
        }
        return {
          originalLineItemId: li.original_line_item_id,
          quantityMilli: quantityToMilli(li.quantity),
          unitPricePaise: li.unit_price_paise,
          discountPaise: li.discount_paise,
          taxableValuePaise: li.taxable_value_paise,
          cgstPaise: li.cgst_paise,
          sgstPaise: li.sgst_paise,
          igstPaise: li.igst_paise,
        };
      }),
    },
    {
      header: {
        subtotalPaise: derivedTotals.subtotalPaise,
        totalCgstPaise: derivedTotals.totalCgstPaise,
        totalSgstPaise: derivedTotals.totalSgstPaise,
        totalIgstPaise: derivedTotals.totalIgstPaise,
        totalTaxPaise: derivedTotals.totalTaxPaise,
        grandTotalPaise: derivedGrand,
      },
      lines: derived,
    },
  );

  // 6. Fetch business profile
  const bizRows = await tx.select().from(businesses).where(eq(businesses.id, params.businessId));
  if (bizRows.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  const business = bizRows[0];

  // 7. Get active financial year
  const issueDateObj = creditNote.issue_date ? parseIsoDateToIstDate(creditNote.issue_date) : new Date();
  const activeFy = await getOrCreateCurrentFinancialYear(tx, params.businessId, issueDateObj);

  // 8. Generate official, sequential Credit Note Number
  const { creditNoteNumber, sequence } = await getNextCreditNoteNumber(tx, {
    businessId: params.businessId,
    financialYearId: activeFy.id,
    fyLabel: activeFy.label,
    prefix: business.credit_note_number_prefix || 'CN',
  });

  const finalizedIssueDate = creditNote.issue_date || formatIstDateAsIso(new Date());

  // 9. Guarded update
  const updated = await tx
    .update(creditNotes)
    .set({
      credit_note_number: creditNoteNumber,
      credit_note_sequence: sequence,
      financial_year_id: activeFy.id,
      lifecycle_status: 'finalized',
      issue_date: finalizedIssueDate,
      finalized_at: new Date(),
      seller_gstin_snapshot: originalInvoice.seller_gstin_snapshot ?? business.gstin,
      ...captureSellerSnapshot(business),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(creditNotes.id, creditNote.id),
        eq(creditNotes.business_id, params.businessId),
        eq(creditNotes.lifecycle_status, 'draft'),
        eq(creditNotes.status, 'active'),
      ),
    )
    .returning({ id: creditNotes.id });

  if (updated.length !== 1) {
    throw new ActionError('This credit note has already been finalized and locked.', { code: 'ALREADY_FINALIZED' });
  }

  // 10. Recalculate original invoice payment status
  await recomputePaymentStatus(tx, originalInvoice);

  return {
    id: creditNote.id,
    creditNoteNumber,
    originalInvoiceId: originalInvoice.id,
  };
}
