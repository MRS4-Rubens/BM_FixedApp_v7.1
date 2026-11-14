import { z } from 'zod';
import {
  DEFAULT_GST_OPTIONS,
  type DefaultGstOption,
  type InvoiceDisplayPrefs,
} from '@/lib/db/schema/_display_prefs';
import { DEFAULT_QUANTITY_DECIMALS, isQuantityDecimals } from '@/lib/invoices/quantity-format';

export const FIXED_ROWS_MIN = 1;
export const FIXED_ROWS_MAX = 50;

export const DEFAULT_INVOICE_DISPLAY_PREFS: InvoiceDisplayPrefs = {
  discEnabled: true,
  showHsn: true,
  showNextNo: true,
  showSignatory: true,
  enableFixedRows: true,
  fixedRowsCount: 13,
  defaultGst: '18',
  // 3 = today's behaviour, so accounts that never chose a Quantity Format see no change.
  quantityDecimals: DEFAULT_QUANTITY_DECIMALS,
};

/** Strict schema for writes (settings form, import action). Unknown keys are rejected. */
export const invoiceDisplayPrefsSchema = z.strictObject({
  discEnabled: z.boolean(),
  showHsn: z.boolean(),
  showNextNo: z.boolean(),
  showSignatory: z.boolean(),
  enableFixedRows: z.boolean(),
  fixedRowsCount: z.number().int().min(FIXED_ROWS_MIN).max(FIXED_ROWS_MAX),
  defaultGst: z.enum(DEFAULT_GST_OPTIONS),
  // Optional so older clients and the legacy import (which never had it) keep working; missing => default.
  quantityDecimals: z.union([z.literal(0), z.literal(2), z.literal(3)]).optional(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefaultGst(value: unknown): value is DefaultGstOption {
  return typeof value === 'string' && DEFAULT_GST_OPTIONS.some((option) => option === value);
}

function isFixedRows(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= FIXED_ROWS_MIN && value <= FIXED_ROWS_MAX;
}

/** Total, never throws. Missing/invalid fields fall back PER FIELD to the defaults. Idempotent: parse(parse(x)) === parse(x). */
export function parseStoredDisplayPrefs(value: unknown): InvoiceDisplayPrefs {
  const src = isPlainObject(value) ? value : {};
  const d = DEFAULT_INVOICE_DISPLAY_PREFS;
  return {
    discEnabled: typeof src.discEnabled === 'boolean' ? src.discEnabled : d.discEnabled,
    showHsn: typeof src.showHsn === 'boolean' ? src.showHsn : d.showHsn,
    showNextNo: typeof src.showNextNo === 'boolean' ? src.showNextNo : d.showNextNo,
    showSignatory: typeof src.showSignatory === 'boolean' ? src.showSignatory : d.showSignatory,
    enableFixedRows: typeof src.enableFixedRows === 'boolean' ? src.enableFixedRows : d.enableFixedRows,
    fixedRowsCount: isFixedRows(src.fixedRowsCount) ? src.fixedRowsCount : d.fixedRowsCount,
    defaultGst: isDefaultGst(src.defaultGst) ? src.defaultGst : d.defaultGst,
    quantityDecimals: isQuantityDecimals(src.quantityDecimals) ? src.quantityDecimals : d.quantityDecimals,
  };
}

/** True when the account has saved at least one preference (i.e. column is not the empty-object default). */
export function hasSavedDisplayPrefs(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

/** Value frozen on the invoice at finalization: ALWAYS the full normalized object (never {}). */
export function captureDisplayPrefsSnapshot(accountPrefs: unknown): InvoiceDisplayPrefs {
  return parseStoredDisplayPrefs(accountPrefs);
}

/** FINALIZED invoice: only its own snapshot; NULL (legacy) => defaults. Never the live account prefs. */
export function resolveFinalizedDisplayPrefs(snapshot: unknown): InvoiceDisplayPrefs {
  return parseStoredDisplayPrefs(snapshot);
}

/** DRAFT invoice / live preview: the account's current prefs. */
export function resolveDraftDisplayPrefs(accountPrefs: unknown): InvoiceDisplayPrefs {
  return parseStoredDisplayPrefs(accountPrefs);
}

