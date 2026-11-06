import { describe, expect, it } from 'vitest';
import {
  INT4_MAX,
  INT4_PRESET,
  MAX_UNIT_PRICE_PAISE,
  MAX_DOCUMENT_TOTAL_PAISE,
  MAX_UNIT_PRICE_RUPEES,
  MAX_LINE_ITEMS,
  MAX_QUANTITY,
  MAX_QUANTITY_MILLI,
  ISO_DATE_MIN_YEAR,
  ISO_DATE_MAX_YEAR,
  EXPORT_MAX_RANGE_DAYS,
  EXPORT_LABEL_MAX_LENGTH,
} from '@/lib/validations/limits';

describe('lib/validations/limits configuration invariants', () => {
  it('enforces active BIGINT preset relational invariants', () => {
    expect(MAX_UNIT_PRICE_PAISE).toBeLessThanOrEqual(MAX_DOCUMENT_TOTAL_PAISE);
    expect(MAX_UNIT_PRICE_RUPEES * 100).toBe(MAX_UNIT_PRICE_PAISE);
    expect(MAX_QUANTITY_MILLI).toBe(Math.round(MAX_QUANTITY * 1000));
    expect(MAX_LINE_ITEMS).toBe(200);
    expect(EXPORT_MAX_RANGE_DAYS).toBe(366);
    expect(EXPORT_LABEL_MAX_LENGTH).toBe(40);
    expect(ISO_DATE_MIN_YEAR).toBe(2017);
    expect(ISO_DATE_MAX_YEAR).toBeGreaterThan(2026);
  });

  it('keeps INT4 preset values bounded below INT4_MAX for reference', () => {
    expect(INT4_PRESET.MAX_UNIT_PRICE_PAISE).toBeLessThan(INT4_MAX);
    expect(INT4_PRESET.MAX_DOCUMENT_TOTAL_PAISE).toBeLessThan(INT4_MAX);
    expect(INT4_PRESET.MAX_UNIT_PRICE_PAISE).toBeLessThan(INT4_PRESET.MAX_DOCUMENT_TOTAL_PAISE);
  });
});
