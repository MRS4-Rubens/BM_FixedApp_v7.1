import { and, eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import { loadCreditContext } from '@/lib/actions/_shared/credit-note-context';
import { writeAudit, type AuditRequestContext } from '@/lib/audit/log';
import type { DbTransaction } from '@/lib/db/client';
import { businesses, creditNoteLineItems, creditNotes } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { lockDraftCreditNote, lockFinalizedInvoice } from '@/lib/invoices/document-locks';
import { getNextCreditNoteNumber } from '@/lib/invoices/credit-note-numbering';
import { evaluateCreditNoteDate } from '@/lib/invoices/credit-note-date-policy';
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
import { parseStoredDisplayPrefs } from '@/lib/invoices/display-prefs';
import { creditQuantityDecimals, quantityFormatViolation } from '@/lib/invoices/quantity-format';

export interface FinalizeCreditNoteTxParams {
  readonly creditNoteId: string;
  readonly businessId: string;
  readonly actorUserId: string | null;
  readonly requestContext: AuditRequestContext;
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
  // COMP-001 / AUTH-004: shared lock, identical to finalize-invoice-tx, so the seller snapshot (incl. logo key)
  // can never be captured from a business row that a concurrent profile/logo edit (FOR UPDATE) is changing.
  const bizRows = await tx.select().from(businesses).where(eq(businesses.id, params.businessId)).for('share');
  if (bizRows.length === 0) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
  const business = bizRows[0];

  // Quantity Format, widened per line to the decimals its original/remaining quantity needs (credit notes must be
  // able to fully credit older decimal lines even after switching to whole numbers).
  const quantityDecimals = parseStoredDisplayPrefs(business.invoice_display_prefs).quantityDecimals;
  const quantityProblem = quantityFormatViolation(
    lineItemRows.map((li) => {
      const state = li.original_line_item_id ? ctx.states.get(li.original_line_item_id) : undefined;
      const originalMilli = state?.original.quantityMilli ?? 0;
      const remainingMilli = state ? Math.max(0, state.original.quantityMilli - state.credited.quantityMilli) : 0;
      return { quantity: li.quantity, decimals: creditQuantityDecimals(quantityDecimals, originalMilli, remainingMilli) };
    }),
  );
  if (quantityProblem) throw new ActionError(quantityProblem, { code: 'QUANTITY_FORMAT' });

  // 7. MONEY-08: the date the credit note will carry (a stored draft date, else today) must pass the date rule again
  //    now: time has moved since the draft was saved, and the date decides the financial year and number series.
  const finalizedIssueDate = creditNote.issue_date || formatIstDateAsIso(new Date());
  const dateDecision = evaluateCreditNoteDate({
    issueDateIso: finalizedIssueDate,
    todayIso: formatIstDateAsIso(new Date()),
    originalInvoiceDateIso: originalInvoice.invoice_date,
  });
  if (!dateDecision.ok) throw new ActionError(dateDecision.message, { code: dateDecision.code });

  // Get active financial year
  const issueDateObj = parseIsoDateToIstDate(finalizedIssueDate);
  const activeFy = await getOrCreateCurrentFinancialYear(tx, params.businessId, issueDateObj);

  // 8. Generate official, sequential Credit Note Number
  const { creditNoteNumber, sequence } = await getNextCreditNoteNumber(tx, {
    businessId: params.businessId,
    financialYearId: activeFy.id,
    fyLabel: activeFy.label,
    prefix: business.credit_note_number_prefix || 'CN',
  });

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
    .returning({
      id: creditNotes.id,
      credit_note_number: creditNotes.credit_note_number,
      credit_note_sequence: creditNotes.credit_note_sequence,
      reason: creditNotes.reason,
      issue_date: creditNotes.issue_date,
      subtotal_paise: creditNotes.subtotal_paise,
      total_tax_paise: creditNotes.total_tax_paise,
      grand_total_paise: creditNotes.grand_total_paise,
    });

  if (updated.length !== 1) {
    throw new ActionError('This credit note has already been finalized and locked.', { code: 'ALREADY_FINALIZED' });
  }

  const [finalized] = updated;
  if (!finalized) {
    throw new ActionError('This credit note has already been finalized and locked.', { code: 'ALREADY_FINALIZED' });
  }

  await writeAudit(tx, {
    businessId: params.businessId,
    actorUserId: params.actorUserId,
    entityType: 'credit_note',
    entityId: finalized.id,
    action: 'finalize',
    requestContext: params.requestContext,
    metadata: {
      credit_note_number: finalized.credit_note_number,
      credit_note_sequence: finalized.credit_note_sequence,
      reason: finalized.reason,
      issue_date: finalized.issue_date,
      subtotal_paise: finalized.subtotal_paise,
      total_tax_paise: finalized.total_tax_paise,
      grand_total_paise: finalized.grand_total_paise,
      original_invoice_id: originalInvoice.id,
      original_invoice_number: originalInvoice.invoice_number,
    },
  });

  // 10. Recalculate original invoice payment status
  await recomputePaymentStatus(tx, originalInvoice);

  return {
    id: creditNote.id,
    creditNoteNumber,
    originalInvoiceId: originalInvoice.id,
  };
}
