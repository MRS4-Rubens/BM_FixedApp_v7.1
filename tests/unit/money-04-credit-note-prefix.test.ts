import { describe, expect, it } from 'vitest';
import { invoiceSettingsSchema } from '@/lib/validations/invoice-settings';
import { businessProfileSchema } from '@/lib/validations/business';
import {
  CREDIT_NOTE_NUMBER_MAX_LENGTH,
  CREDIT_NOTE_PREFIX_MAX_LENGTH,
  formatCreditNoteNumber,
} from '@/lib/invoices/credit-note-prefix';

/** MONEY-04: a prefix longer than 6 characters made every credit-note finalize fail with NUMBER_TOO_LONG. */
const settings = (prefix: string) =>
  invoiceSettingsSchema.safeParse({
    invoice_number_format: 'BMA/{FY}/{SEQ:4}',
    credit_note_number_prefix: prefix,
    payment_due_days: 30,
    default_invoice_template: 'template_1',
    default_gst_rate_type: 'exclusive',
    invoice_terms: '',
  });

const prefixIssue = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  result.error?.issues.find((issue) => issue.path[0] === 'credit_note_number_prefix')?.message;

describe('MONEY-04: credit-note prefix fits the 16-character legal limit', () => {
  it('the longest allowed prefix still gives a legal number up to sequence 999', () => {
    const longest = 'A'.repeat(CREDIT_NOTE_PREFIX_MAX_LENGTH);
    expect(formatCreditNoteNumber(longest, '2026-27', 999)).toBe('AAAAAA/26-27/999');
    expect(formatCreditNoteNumber(longest, '2026-27', 999)).toHaveLength(CREDIT_NOTE_NUMBER_MAX_LENGTH);
  });

  it('invoice settings accept a 6-character prefix and reject 7 with a clear message', () => {
    expect(settings('CREDIT').success).toBe(true);
    const tooLong = settings('CREDITN');
    expect(tooLong.success).toBe(false);
    expect(prefixIssue(tooLong)).toContain('6 characters or fewer');
  });

  it('the business profile schema applies the same limit', () => {
    const base = businessProfileSchema.shape.credit_note_number_prefix;
    expect(base.safeParse('CREDIT').success).toBe(true);
    expect(base.safeParse('CREDITN').success).toBe(false);
    expect(base.safeParse('').success).toBe(true); // still optional on first-time setup
  });

  it('formats exactly like the default example and falls back to CN for a blank prefix', () => {
    expect(formatCreditNoteNumber('cn', '2026-27', 1)).toBe('CN/26-27/001');
    expect(formatCreditNoteNumber('  ', '2026-27', 12)).toBe('CN/26-27/012');
  });
});
