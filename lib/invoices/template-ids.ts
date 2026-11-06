/**
 * Single source of truth for invoice template identifiers.
 * Enforced by database CHECK constraints (DB-004: invoices_invoice_template_valid, businesses_default_invoice_template_valid).
 * Re-exported by lib/db/domain-values.ts.
 */
export const INVOICE_TEMPLATE_IDS = ['template_1', 'template_2', 'template_3', 'template_4'] as const;
export type InvoiceTemplateId = (typeof INVOICE_TEMPLATE_IDS)[number];
export const DEFAULT_INVOICE_TEMPLATE_ID: InvoiceTemplateId = 'template_1';

export function isInvoiceTemplateId(value: string): value is InvoiceTemplateId {
  return INVOICE_TEMPLATE_IDS.some((id) => id === value);
}
