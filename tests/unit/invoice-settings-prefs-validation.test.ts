import { describe, expect, it } from 'vitest';
import { invoiceSettingsSchema } from '@/lib/validations/invoice-settings';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

describe('invoiceSettingsSchema display_prefs validation (FE-001)', () => {
  const baseValid = {
    invoice_number_format: 'INV/{FY}/{SEQ:4}',
    credit_note_number_prefix: 'CN',
    payment_due_days: 30,
    default_invoice_template: 'template_1',
    default_gst_rate_type: 'exclusive',
    invoice_terms: 'Payment due within 30 days',
  };

  it('validates successfully when display_prefs is omitted', () => {
    const result = invoiceSettingsSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display_prefs).toBeUndefined();
    }
  });

  it('validates successfully when display_prefs is provided and valid', () => {
    const result = invoiceSettingsSchema.safeParse({
      ...baseValid,
      display_prefs: DEFAULT_INVOICE_DISPLAY_PREFS,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display_prefs).toEqual(DEFAULT_INVOICE_DISPLAY_PREFS);
    }
  });

  it('rejects when display_prefs contains unrecognized extra keys', () => {
    const result = invoiceSettingsSchema.safeParse({
      ...baseValid,
      display_prefs: {
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        unrecognizedKey: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when display_prefs fields fail constraint validation', () => {
    const result = invoiceSettingsSchema.safeParse({
      ...baseValid,
      display_prefs: {
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        fixedRowsCount: 100, // exceeds max 50
      },
    });
    expect(result.success).toBe(false);
  });
});

