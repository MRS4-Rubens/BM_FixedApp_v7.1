

/** Single source of truth for invoice template identifiers (DB-004 will add a matching CHECK constraint). */
export const INVOICE_TEMPLATE_IDS = ['template_1', 'template_2', 'template_3', 'template_4'] as const;
export type InvoiceTemplateId = (typeof INVOICE_TEMPLATE_IDS)[number];
export const DEFAULT_INVOICE_TEMPLATE_ID: InvoiceTemplateId = 'template_1';

export function isInvoiceTemplateId(value: string): value is InvoiceTemplateId {
  return INVOICE_TEMPLATE_IDS.some((id) => id === value);
}
