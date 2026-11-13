export const INVOICE_TAGLINE_MAX = 80;
export const INVOICE_TAGLINE_ALLOWED = /^[A-Z0-9 &@,.;:\-\/()'+|]*$/; // checked AFTER normalising

export function normaliseInvoiceTagline(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const replaced = raw.replace(/[\r\n\t]+/g, ' ');
  const collapsed = replaced.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.toUpperCase();
}

export const INVOICE_TAGLINE_EXAMPLES = [
  'WHOLESALERS & RETAILERS OF TEXT BOOKS, NOTE BOOKS, EXAM BOOKS & STATIONERY',
  'WHOLESALERS & RETAILERS @ SHIRTS, TROUSERS, COTTON & SILK ITEMS',
  'DEALERS IN MOBILE PHONES, ACCESSORIES & REPAIRS',
  'AUTHORISED DEALER OF ELECTRICAL GOODS & HOME APPLIANCES',
  'SPECIALISTS IN PAINTS, HARDWARE & SANITARY FITTINGS',
  'SUPPLIERS OF GROCERIES, FMCG & HOUSEHOLD ESSENTIALS',
] as const;

