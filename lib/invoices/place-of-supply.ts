import { ActionError } from '@/lib/actions/_shared/errors';
import { roundToRupeePaise } from '@/lib/credit-notes/derivation';
import { isValidStateCode } from '@/lib/gst/indian-states';
import type { TaxCalculationResult } from '@/lib/gst/types';

/** The six totals persisted on a draft invoice (integer paise). */
export interface StoredInvoiceTotals {
  readonly subtotal_paise: number;
  readonly total_cgst_paise: number;
  readonly total_sgst_paise: number;
  readonly total_igst_paise: number;
  readonly total_tax_paise: number;
  readonly grand_total_paise: number;
}

export type TotalsField = 'subtotal' | 'CGST' | 'SGST' | 'IGST' | 'total tax' | 'grand total';

/**
 * COMP-003: the Place of Supply the user chose on the draft is authoritative at finalize.
 * A missing/invalid value is rejected — NEVER silently replaced by the customer's or the seller's state.
 */
export function resolveDraftPlaceOfSupply(stored: string | null | undefined): string {
  if (!isValidStateCode(stored)) {
    throw new ActionError(
      'This draft has no valid Place of Supply. Select the delivery state on the invoice, save the draft, and finalize again.',
      { code: 'INVALID_PLACE_OF_SUPPLY' },
    );
  }
  return stored;
}

/** Fields where the recalculated totals differ from the totals stored on the draft. Empty array = identical. */
export function findTotalsMismatches(
  stored: StoredInvoiceTotals,
  recalculated: TaxCalculationResult,
): readonly TotalsField[] {
  const mismatches: TotalsField[] = [];
  if (stored.subtotal_paise !== recalculated.subtotalPaise) mismatches.push('subtotal');
  if (stored.total_cgst_paise !== recalculated.totalCgstPaise) mismatches.push('CGST');
  if (stored.total_sgst_paise !== recalculated.totalSgstPaise) mismatches.push('SGST');
  if (stored.total_igst_paise !== recalculated.totalIgstPaise) mismatches.push('IGST');
  if (stored.total_tax_paise !== recalculated.totalTaxPaise) mismatches.push('total tax');
  if (stored.grand_total_paise !== roundToRupeePaise(recalculated.grandTotalPaise)) mismatches.push('grand total');
  return mismatches;
}

/** Throws DRAFT_TOTALS_MISMATCH (before any write) when the recalculation disagrees with the draft the user approved. */
export function assertDraftTotalsMatch(stored: StoredInvoiceTotals, recalculated: TaxCalculationResult): void {
  const mismatches = findTotalsMismatches(stored, recalculated);
  if (mismatches.length > 0) {
    throw new ActionError(
      `This draft's saved totals no longer match the current tax calculation (${mismatches.join(', ')}). ` +
        'Nothing was finalized. Open the draft, review the totals, save it again, and then finalize.',
      { code: 'DRAFT_TOTALS_MISMATCH' },
    );
  }
}

