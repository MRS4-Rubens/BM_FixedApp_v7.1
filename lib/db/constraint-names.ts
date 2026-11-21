/** Single source of truth for constraint/index names that application code maps to user-facing errors. */
export const DB_CONSTRAINTS = {
  BUSINESSES_GSTIN_UNIQUE: 'businesses_gstin_unique',
  // Partial unique index on customers(business_id, gstin) where gstin is not null (CUST-GSTIN-UNIQUE, migration 0036).
  // The index name MUST stay exactly this: CUSTOMER_MAPPINGS turns its 23505 into DUPLICATE_CUSTOMER_GSTIN.
  CUSTOMERS_BUSINESS_GSTIN_UNIQUE: 'customers_biz_gstin_uq',
  // Business-wide unique invoice number (migration 0000). MONEY-01: FINALIZE_INVOICE_MAPPINGS turns its 23505 into
  // DUPLICATE_INVOICE_NUMBER (a number format that repeats an earlier number).
  INVOICES_BUSINESS_INVOICE_NUMBER_UNIQUE: 'invoices_business_id_invoice_number_unique',
} as const;

export type DbConstraintName = (typeof DB_CONSTRAINTS)[keyof typeof DB_CONSTRAINTS];

