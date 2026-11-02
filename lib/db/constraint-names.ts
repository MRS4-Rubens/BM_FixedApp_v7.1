/** Single source of truth for constraint/index names that application code maps to user-facing errors. */
export const DB_CONSTRAINTS = {
  BUSINESSES_GSTIN_UNIQUE: 'businesses_gstin_unique',
  // Created later by DB-005 (partial unique on customers(business_id, gstin) where gstin is not null).
  // The mapping below is inert until that constraint exists; DB-005 MUST use exactly this name.
  CUSTOMERS_BUSINESS_GSTIN_UNIQUE: 'customers_biz_gstin_uq',
} as const;

export type DbConstraintName = (typeof DB_CONSTRAINTS)[keyof typeof DB_CONSTRAINTS];

