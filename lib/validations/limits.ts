/** Single source of truth for input ceilings. DB-003 (int4 -> bigint) switches the preset below; nothing else hard-codes limits. */
export const INT4_MAX = 2_147_483_647;

// ---- Preset: INT4 (money columns are `integer`). Kept for reference and testing. ----
export const INT4_PRESET = {
  MAX_UNIT_PRICE_PAISE: 1_000_000_000,       // ₹1,00,00,000.00
  MAX_DOCUMENT_TOTAL_PAISE: 2_000_000_000,   // ₹2,00,00,000.00 (must stay below INT4_MAX while columns are int4)
} as const;

// ---- BIGINT preset (active because DB-003 has landed; grand_total_paise is bigint) ----
export const MAX_UNIT_PRICE_PAISE = 999_999_999;         // ₹99,99,999.99
export const MAX_DOCUMENT_TOTAL_PAISE = 999_999_999_999; // ₹9,99,99,99,999.99 (~₹100 crore)

export const MAX_UNIT_PRICE_RUPEES = MAX_UNIT_PRICE_PAISE / 100;
export const MAX_LINE_ITEMS = 200;
export const MAX_QUANTITY = 9_999_999.999;        // numeric(10,3) column limit
export const MAX_QUANTITY_MILLI = 9_999_999_999;
export const ISO_DATE_MIN_YEAR = 2017;            // GST regime start
export const ISO_DATE_MAX_YEAR = 2100;
export const EXPORT_MAX_RANGE_DAYS = 366;
export const EXPORT_LABEL_MAX_LENGTH = 40;
