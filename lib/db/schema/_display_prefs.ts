import type { QuantityDecimals } from '@/lib/invoices/quantity-format';

/** FE-001: invoice display & entry preferences: what an invoice SHOWS and how its form is filled (not legal content). */
export interface InvoiceDisplayPrefs {
  readonly discEnabled: boolean; // discount column (templates 2–4 + draft form)
  readonly showHsn: boolean; // HSN/SAC column (all templates + draft form)
  readonly showNextNo: boolean; // persisted, NOT rendered anywhere today
  readonly showSignatory: boolean; // persisted, NOT rendered anywhere today
  readonly enableFixedRows: boolean; // pad item table with empty rows
  readonly fixedRowsCount: number; // 1..50, used when enableFixedRows
  readonly defaultGst: DefaultGstOption; // persisted, NOT rendered anywhere today
  readonly quantityDecimals: QuantityDecimals; // Quantity Format: 0 = whole numbers, 2 or 3 decimal places
}

export const DEFAULT_GST_OPTIONS = ['0', '5', '12', '18', '28'] as const;
export type DefaultGstOption = (typeof DEFAULT_GST_OPTIONS)[number];

/** What the businesses column may hold: {} (never saved) or any subset of the fields. */
export type StoredInvoiceDisplayPrefs = Partial<InvoiceDisplayPrefs>;

