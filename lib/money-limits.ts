/**
 * Monetary and quantity ceilings (DB-003). Single source of truth for Zod, the GST engine and tests.
 *
 * Money is stored as integer paise in Postgres `bigint` and read back as a JS number (`mode: 'number'`).
 * JS numbers are exact only up to Number.MAX_SAFE_INTEGER, so every ceiling here sits far below it:
 * 200 lines * ~1.28 (max GST) * MAX_LINE_GROSS_PAISE  <<  MAX_SAFE_PAISE.
 *
 * The database enforces ONLY the hard technical bound (MAX_SAFE_PAISE) via CHECK constraints. The business
 * ceilings below live in code so they can be tuned without a migration.
 *
 * MAX_DOCUMENT_TOTAL_PAISE is deliberately < INR 1,000 crore: lib/pdf/number-to-words.ts groups the crore
 * part with a 3-digit converter and is only correct below that.
 */

/** Hard technical bound; hard-coded in DB CHECK constraints as 9007199254740991. */
export const MAX_SAFE_PAISE = Number.MAX_SAFE_INTEGER;

export const MAX_UNIT_PRICE_PAISE = 999_999_999;
export const MAX_UNIT_PRICE_RUPEES = 9_999_999.99;
export const MAX_QUANTITY = 9_999_999.999;
export const MAX_INVOICE_LINE_ITEMS = 200;

export const MAX_LINE_GROSS_PAISE = 999_999_999_999;
export const MAX_DOCUMENT_TOTAL_PAISE = 999_999_999_999;

/** Human-readable (Indian grouping) labels for validation messages. */
export const MAX_UNIT_PRICE_LABEL = '₹99,99,999.99';
export const MAX_QUANTITY_LABEL = '99,99,999.999';
export const MAX_AMOUNT_LABEL = '₹9,99,99,99,999.99';

