import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

describe('invoice-templates display preferences rendering (FE-001)', () => {
  const dummyInvoice = {
    id: 'inv-test-1',
    business_name: 'Test Business Pvt Ltd',
    city: 'Mumbai',
    seller_gstin_snapshot: '27AABCU9603R1ZM',
    phone: '9876543210',
    bank_name: 'State Bank of India',
    bank_account_number: '12345678901',
    bank_ifsc: 'SBIN0001234',
    invoice_terms: 'Payment due on receipt',
    invoice_number: 'INV-2026-0001',
    invoice_date: '2026-04-01',
    billing_name_snapshot: 'Customer Acme',
    billing_gstin_snapshot: '27AABCU9603R1ZM',
    billing_address_snapshot: '456 Commercial Rd',
    place_of_supply_state_code: '27',
    subtotal_paise: 100000,
    total_cgst_paise: 9000,
    total_sgst_paise: 9000,
    total_igst_paise: 0,
    total_tax_paise: 18000,
    grand_total_paise: 118000,
    lineItems: [
      {
        id: 'li-1',
        description: 'Consulting Services',
        hsn_sac_code: '998311',
        quantity: 1,
        unit_price_paise: 100000,
        discount_paise: 0,
        taxable_value_paise: 100000,
        tax_rate_percentage: 18,
        cgst_paise: 9000,
        sgst_paise: 9000,
        igst_paise: 0,
        line_total_paise: 118000,
      },
    ],
  };

  const templates = ['template_1', 'template_2', 'template_3', 'template_4'] as const;

  for (const templateId of templates) {
    it(`renders ${templateId} with default preferences without throwing`, () => {
      const html = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: { ...dummyInvoice, invoice_template: templateId },
          businessStateCode: '27',
          displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
        }),
      );
      expect(html).toContain('INV-2026-0001');
      expect(html).toContain('Consulting Services');
    });

    it(`toggles HSN column correctly on ${templateId}`, () => {
      const withHsn = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: { ...dummyInvoice, invoice_template: templateId },
          businessStateCode: '27',
          displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showHsn: true },
        }),
      );
      expect(withHsn).toMatch(/HSN|HSN\/SAC/i);

      const withoutHsn = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: { ...dummyInvoice, invoice_template: templateId },
          businessStateCode: '27',
          displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showHsn: false },
        }),
      );
      // When showHsn is false, the table header HSN column should not exist
      expect(withoutHsn).not.toMatch(/<th[^>]*>HSN/i);
    });
  }

  // Discount toggles for templates 2, 3, 4
  const discTemplates = ['template_2', 'template_3', 'template_4'] as const;
  for (const templateId of discTemplates) {
    it(`toggles discount column correctly on ${templateId}`, () => {
      const withDisc = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: { ...dummyInvoice, invoice_template: templateId },
          businessStateCode: '27',
          displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, discEnabled: true },
        }),
      );
      expect(withDisc).toMatch(/Disc/i);

      const withoutDisc = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: { ...dummyInvoice, invoice_template: templateId },
          businessStateCode: '27',
          displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, discEnabled: false },
        }),
      );
      expect(withoutDisc).not.toMatch(/<th[^>]*>Disc/i);
    });
  }
});
