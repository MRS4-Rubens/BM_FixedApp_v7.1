import { DB_CONSTRAINTS } from '@/lib/db/constraint-names';
import type { PgConstraintMapping } from './action-error-mapping';

const UNIQUE_VIOLATION = '23505';

export const BUSINESS_PROFILE_MAPPINGS: readonly PgConstraintMapping[] = [
  {
    sqlState: UNIQUE_VIOLATION,
    constraint: DB_CONSTRAINTS.BUSINESSES_GSTIN_UNIQUE,
    code: 'DUPLICATE_GSTIN',
    message: 'This GSTIN is already registered with another Bill Matrix account. Check the number or contact support.',
    field: 'gstin',
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

