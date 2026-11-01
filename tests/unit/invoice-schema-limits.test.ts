import { describe, expect, it } from 'vitest';
import { invoiceDraftSchema } from '@/lib/validations/invoice';
import { productSchema } from '@/lib/validations/product';
import {
  MAX_AMOUNT_LABEL,
  MAX_INVOICE_LINE_ITEMS,
  MAX_QUANTITY_LABEL,
  MAX_UNIT_PRICE_LABEL,
} from '@/lib/money-limits';

function validDraftInput(overrides: Record<string, unknown> = {}) {
  return {
    billing_name: 'Acme Enterprises Ltd',
    place_of_supply_state_code: '27',
    gst_rate_type: 'exclusive' as const,
    line_items: [
      {
        description: 'Consulting Services',
        hsn_sac_code: '99831111',
        quantity: 1,
        unit_of_measurement: 'OTH',
        unit_price: 1000,
        discount: 0,
        tax_rate_id: '11111111-1111-4111-8111-111111111111',
      },
    ],
    ...overrides,
  };
}

describe('Invoice and product schema validation limits (DB-003)', () => {
  it('baseline valid draft passes schema parsing', () => {
    const parsed = invoiceDraftSchema.safeParse(validDraftInput());
    expect(parsed.success).toBe(true);
  });

  it('accepts unit_price at ₹99,99,999.99 and rejects 10_000_000 with clear message', () => {
    const validPrice = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: [
          {
            description: 'Heavy machinery item',
            hsn_sac_code: '84713010',
            quantity: 1,
            unit_of_measurement: 'NOS',
            unit_price: 9_999_999.99,
            discount: 0,
            tax_rate_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      })
    );
    expect(validPrice.success).toBe(true);

    const invalidPrice = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: [
          {
            description: 'Heavy machinery item',
            hsn_sac_code: '84713010',
            quantity: 1,
            unit_of_measurement: 'NOS',
            unit_price: 10_000_000,
            discount: 0,
            tax_rate_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      })
    );
    expect(invalidPrice.success).toBe(false);
    if (!invalidPrice.success) {
      const issue = invalidPrice.error.issues.find(
        (i) => i.path.join('.') === 'line_items.0.unit_price'
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`Rate cannot exceed ${MAX_UNIT_PRICE_LABEL}`);
    }
  });

  it('accepts quantity 9_999_999.999 and rejects 10_000_000', () => {
    const validQty = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: [
          {
            description: 'Bulk raw material',
            hsn_sac_code: '12345678',
            quantity: 9_999_999.999,
            unit_of_measurement: 'KGS',
            unit_price: 0.1,
            discount: 0,
            tax_rate_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      })
    );
    expect(validQty.success).toBe(true);

    const invalidQty = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: [
          {
            description: 'Bulk raw material',
            hsn_sac_code: '12345678',
            quantity: 10_000_000,
            unit_of_measurement: 'KGS',
            unit_price: 0.1,
            discount: 0,
            tax_rate_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      })
    );
    expect(invalidQty.success).toBe(false);
    if (!invalidQty.success) {
      const issue = invalidQty.error.issues.find(
        (i) => i.path.join('.') === 'line_items.0.quantity'
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`Quantity cannot exceed ${MAX_QUANTITY_LABEL}`);
    }
  });

  it('accepts exactly 200 line items and rejects 201 line items', () => {
    const baseLine = {
      description: 'Standard Line',
      hsn_sac_code: '84713010',
      quantity: 1,
      unit_of_measurement: 'NOS',
      unit_price: 10,
      discount: 0,
      tax_rate_id: '11111111-1111-4111-8111-111111111111',
    };

    const twoHundredLines = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: Array.from({ length: MAX_INVOICE_LINE_ITEMS }, () => ({ ...baseLine })),
      })
    );
    expect(twoHundredLines.success).toBe(true);

    const twoHundredAndOneLines = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: Array.from({ length: MAX_INVOICE_LINE_ITEMS + 1 }, () => ({ ...baseLine })),
      })
    );
    expect(twoHundredAndOneLines.success).toBe(false);
    if (!twoHundredAndOneLines.success) {
      const issue = twoHundredAndOneLines.error.issues.find((i) => i.path.join('.') === 'line_items');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`Invoice cannot exceed ${MAX_INVOICE_LINE_ITEMS} line items`);
    }
  });

  it('rejects line where gross (quantity * unit_price) exceeds MAX_LINE_GROSS_PAISE', () => {
    const invalidGross = invoiceDraftSchema.safeParse(
      validDraftInput({
        line_items: [
          {
            description: 'Extreme line gross item',
            hsn_sac_code: '84713010',
            quantity: 9_999_999,
            unit_of_measurement: 'NOS',
            unit_price: 9_999_999,
            discount: 0,
            tax_rate_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      })
    );
    expect(invalidGross.success).toBe(false);
    if (!invalidGross.success) {
      const issue = invalidGross.error.issues.find(
        (i) => i.path.join('.') === 'line_items.0.unit_price'
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`Line item gross amount cannot exceed ${MAX_AMOUNT_LABEL}`);
    }
  });

  it('productSchema rejects default_sale_price 10_000_000 and accepts 9_999_999.99', () => {
    const validProduct = productSchema.safeParse({
      name: 'Server Rack',
      hsn_sac_code: '84714190',
      unit_of_measurement: 'NOS',
      default_sale_price: 9_999_999.99,
    });
    expect(validProduct.success).toBe(true);

    const invalidProduct = productSchema.safeParse({
      name: 'Server Rack',
      hsn_sac_code: '84714190',
      unit_of_measurement: 'NOS',
      default_sale_price: 10_000_000,
    });
    expect(invalidProduct.success).toBe(false);
    if (!invalidProduct.success) {
      const issue = invalidProduct.error.issues.find((i) => i.path.join('.') === 'default_sale_price');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`Price cannot exceed ${MAX_UNIT_PRICE_LABEL}`);
    }
  });
});

