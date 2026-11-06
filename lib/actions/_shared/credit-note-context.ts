import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/actions/_shared/ownership';
import { creditNoteLineItems, creditNotes, invoiceLineItems } from '@/lib/db/schema';
import {
  buildCreditLineStates,
  quantityToMilli,
  type CreditLineState,
  type CreditedLineRow,
  type OriginalLineState,
} from '@/lib/credit-notes/derivation';

export interface CreditContext {
  readonly states: Map<string, CreditLineState>;
  readonly invoiceExactTotalPaise: number;
  readonly otherCreditNotesGrandPaise: number;
  readonly otherCreditNotesExactPaise: number;
}

export interface LoadCreditContextArgs {
  readonly businessId: string;
  readonly invoiceId: string;
  readonly excludeCreditNoteId?: string;
}

/**
 * Single source of truth for "what is already credited" against an invoice.
 * PRECONDITION: The CALLER must already have verified (business-scoped) that `invoiceId`
 * belongs to `businessId`.
 */
export async function loadCreditContext(
  executor: DbExecutor,
  args: LoadCreditContextArgs,
): Promise<CreditContext> {
  // 1. Select original invoice line items
  const origRows = await executor
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoice_id, args.invoiceId))
    .orderBy(invoiceLineItems.sort_order);

  let invoiceExactTotalPaise = 0;
  const originals: OriginalLineState[] = origRows.map((row): OriginalLineState => {
    invoiceExactTotalPaise += row.line_total_paise;
    return {
      originalLineItemId: row.id,
      productId: row.product_id,
      description: row.description,
      hsnSacCode: row.hsn_sac_code,
      unitOfMeasurement: row.unit_of_measurement,
      unitPricePaise: row.unit_price_paise,
      taxRatePercentage: row.tax_rate_percentage,
      quantityMilli: quantityToMilli(row.quantity),
      sortOrder: row.sort_order,
      discountPaise: row.discount_paise,
      taxableValuePaise: row.taxable_value_paise,
      cgstPaise: row.cgst_paise,
      sgstPaise: row.sgst_paise,
      igstPaise: row.igst_paise,
    };
  });

  // 2. Select credited rows from other active/draft (non-voided) credit notes
  const noteConditions = [
    eq(creditNotes.business_id, args.businessId),
    eq(creditNotes.original_invoice_id, args.invoiceId),
    ne(creditNotes.status, 'voided'),
  ];
  if (args.excludeCreditNoteId) {
    noteConditions.push(ne(creditNotes.id, args.excludeCreditNoteId));
  }

  const creditedQueryRows = await executor
    .select({
      original_line_item_id: creditNoteLineItems.original_line_item_id,
      quantity: creditNoteLineItems.quantity,
      discount_paise: creditNoteLineItems.discount_paise,
      taxable_value_paise: creditNoteLineItems.taxable_value_paise,
      cgst_paise: creditNoteLineItems.cgst_paise,
      sgst_paise: creditNoteLineItems.sgst_paise,
      igst_paise: creditNoteLineItems.igst_paise,
    })
    .from(creditNoteLineItems)
    .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLineItems.credit_note_id))
    .where(and(...noteConditions));

  let otherCreditNotesExactPaise = 0;
  const creditedRows: CreditedLineRow[] = creditedQueryRows.map((row): CreditedLineRow => {
    otherCreditNotesExactPaise +=
      row.taxable_value_paise + row.cgst_paise + row.sgst_paise + row.igst_paise;
    return {
      originalLineItemId: row.original_line_item_id,
      quantityMilli: quantityToMilli(row.quantity),
      discountPaise: row.discount_paise,
      taxableValuePaise: row.taxable_value_paise,
      cgstPaise: row.cgst_paise,
      sgstPaise: row.sgst_paise,
      igstPaise: row.igst_paise,
    };
  });

  // 3. Aggregate grand total across the same credit notes
  const [grandTotalRow] = await executor
    .select({ total: sql<string | number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)` })
    .from(creditNotes)
    .where(and(...noteConditions));

  const otherCreditNotesGrandPaise = Number(grandTotalRow?.total ?? 0);

  // 4. Build per-original-line state
  const states = buildCreditLineStates(originals, creditedRows);

  return {
    states,
    invoiceExactTotalPaise,
    otherCreditNotesGrandPaise,
    otherCreditNotesExactPaise,
  };
}
