import { DB_CONSTRAINTS } from '@/lib/db/constraint-names';
import type { PgConstraintMapping } from './action-error-mapping';

const UNIQUE_VIOLATION = '23505';

export const BUSINESS_PROFILE_MAPPINGS: readonly PgConstraintMapping[] = [
  {
    sqlState: UNIQUE_VIOLATION,
    constraint: DB_CONSTRAINTS.BUSINESSES_GSTIN_UNIQUE,
    code: 'DUPLICATE_GSTIN',
    message: 'This GSTIN is already registered with another Invoice BizFolio account. Check the number or contact support.',
    field: 'gstin',
  },
];

/** MONEY-01: a number format that prints an earlier invoice's number again (the transaction rolls back; nothing is burned). */
export const FINALIZE_INVOICE_MAPPINGS: readonly PgConstraintMapping[] = [
  {
    sqlState: UNIQUE_VIOLATION,
    constraint: DB_CONSTRAINTS.INVOICES_BUSINESS_INVOICE_NUMBER_UNIQUE,
    code: 'DUPLICATE_INVOICE_NUMBER',
    message:
      'Your invoice number format would repeat an earlier invoice number, so this invoice was not finalized. Go to Settings → Invoice Settings and add {FY} to the number format (for example INV/{FY}/{SEQ:4}), then finalize again.',
  },
];

export const CUSTOMER_MAPPINGS: readonly PgConstraintMapping[] = [
  {
    sqlState: UNIQUE_VIOLATION,
    constraint: DB_CONSTRAINTS.CUSTOMERS_BUSINESS_GSTIN_UNIQUE,
    code: 'DUPLICATE_CUSTOMER_GSTIN',
    message: 'A customer with this GSTIN already exists in your account.',
    field: 'gstin',
  },
];

