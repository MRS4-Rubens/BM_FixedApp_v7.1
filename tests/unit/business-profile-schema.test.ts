import { describe, expect, it } from 'vitest';
import { businessProfileSchema } from '@/lib/validations/business';
import { invoiceSettingsSchema } from '@/lib/validations/invoice-settings';
import { INVOICE_TEMPLATE_IDS } from '@/lib/invoices/template-ids';

describe('businessProfileSchema & invoiceSettingsSchema (API-007)', () => {
  const formShapedProfile = {
    legal_name: 'Acme Technologies Pvt Ltd',
    trade_name: 'Acme Tech',
    gstin: '29ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    registration_type: 'regular' as const,
    address_line1: '123 Tech Park',
    address_line2: 'Outer Ring Road',
    city: 'Bengaluru',
    state_code: '29',
    pincode: '560103',
    phone: '9876543210',
    alternate_phone: '',
    email: 'contact@acme.com',
    nature_of_business: 'Software Development',
    bank_account_name: 'Acme Technologies Pvt Ltd',
    bank_account_number: '123456789012',
    bank_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
  };

  const validBaseInvoiceSettings = {
    invoice_number_format: 'BMA/{FY}/{SEQ:4}',
    credit_note_number_prefix: 'CN',
    payment_due_days: 30,
    default_invoice_template: 'template_1',
    default_gst_rate_type: 'exclusive' as const,
    invoice_terms: 'Payment due in 30 days',
  };

  it('parses form-shaped payload with default_invoice_template and default_gst_rate_type as undefined (root cause regression)', () => {
    const parsed = businessProfileSchema.safeParse(formShapedProfile);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.default_invoice_template).toBeUndefined();
    expect(parsed.data.default_gst_rate_type).toBeUndefined();
  });

  it('accepts template_3 (entitlement is an action-level concern) and rejects template_9 or empty string', () => {
    const validWithTemplate3 = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_invoice_template: 'template_3',
    });
    expect(validWithTemplate3.success).toBe(true);
    if (validWithTemplate3.success) {
      expect(validWithTemplate3.data.default_invoice_template).toBe('template_3');
    }

    const invalidTemplate9 = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_invoice_template: 'template_9',
    });
    expect(invalidTemplate9.success).toBe(false);

    const emptyTemplate = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_invoice_template: '',
    });
    expect(emptyTemplate.success).toBe(false);
  });

  it('accepts valid default_gst_rate_type and rejects bogus values', () => {
    const inclusive = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_gst_rate_type: 'inclusive',
    });
    expect(inclusive.success).toBe(true);
    if (inclusive.success) {
      expect(inclusive.data.default_gst_rate_type).toBe('inclusive');
    }

    const exclusive = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_gst_rate_type: 'exclusive',
    });
    expect(exclusive.success).toBe(true);
    if (exclusive.success) {
      expect(exclusive.data.default_gst_rate_type).toBe('exclusive');
    }

    const bogus = businessProfileSchema.safeParse({
      ...formShapedProfile,
      default_gst_rate_type: 'bogus',
    });
    expect(bogus.success).toBe(false);
  });

  it('invoiceSettingsSchema still accepts exactly the 4 template ids and rejects others', () => {
    for (const tid of INVOICE_TEMPLATE_IDS) {
      const res = invoiceSettingsSchema.safeParse({
        ...validBaseInvoiceSettings,
        default_invoice_template: tid,
      });
      expect(res.success).toBe(true);
    }

    for (const invalid of ['template_0', 'template_5', '', 'bogus', 'template_9']) {
      const res = invoiceSettingsSchema.safeParse({
        ...validBaseInvoiceSettings,
        default_invoice_template: invalid,
      });
      expect(res.success).toBe(false);
    }
  });
});

