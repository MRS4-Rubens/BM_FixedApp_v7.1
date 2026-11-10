import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { CreditNotePrintView } from '@/components/app/credit-notes/credit-note-print-view';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

describe('COMP-UTGST: statutory document rendering (UTGST vs SGST)', () => {
  const dummyLine = {
    id: 'li-1',
    description: 'Hardware Supplies',
    hsn_sac_code: '84713010',
    quantity: 1,
    unit_of_measurement: 'NOS',
    unit_price_paise: 100_000,
    discount_paise: 0,
    taxable_value_paise: 100_000,
    tax_rate_percentage: 18,
    cgst_paise: 9_000,
    sgst_paise: 9_000,
    igst_paise: 0,
    line_total_paise: 118_000,
  };

  const createInvoice = (sellerState: string, posState: string, templateId: string) => {
    const isIntra = sellerState === posState;
    return {
      id: 'inv-doc-test',
      business_name: 'Doc Supplies Hub',
      city: sellerState === '04' ? 'Chandigarh' : 'Mumbai',
      seller_gstin_snapshot: `${sellerState}AABCU9603R1ZM`,
      phone: '9876543210',
      bank_name: 'State Bank of India',
      bank_account_number: '12345678901',
      bank_ifsc: 'SBIN0001234',
      invoice_terms: 'Due upon receipt',
      invoice_number: 'INV-DOC-01',
      invoice_date: '2026-05-01',
      billing_name_snapshot: 'Test Customer',
      billing_gstin_snapshot: `${posState}BBBCU9603R1ZN`,
      billing_address_snapshot: 'Sector 17, Chandigarh',
      place_of_supply_state_code: posState,
      invoice_template: templateId,
      subtotal_paise: 100_000,
      total_cgst_paise: isIntra ? 9_000 : 0,
      total_sgst_paise: isIntra ? 9_000 : 0,
      total_igst_paise: isIntra ? 0 : 18_000,
      total_tax_paise: 18_000,
      grand_total_paise: 118_000,
      lineItems: [
        {
          ...dummyLine,
          cgst_paise: isIntra ? 9_000 : 0,
          sgst_paise: isIntra ? 9_000 : 0,
          igst_paise: isIntra ? 0 : 18_000,
        },
      ],
    };
  };

  const createCreditNote = (sellerState: string, posState: string) => {
    const isIntra = sellerState === posState;
    return {
      id: 'cn-doc-test',
      credit_note_number: 'CN-2026-0001',
      issue_date: '2026-05-10',
      reason: '01-sales-return' as const,
      subtotal_paise: 100_000,
      total_cgst_paise: isIntra ? 9_000 : 0,
      total_sgst_paise: isIntra ? 9_000 : 0,
      total_igst_paise: isIntra ? 0 : 18_000,
      total_tax_paise: 18_000,
      grand_total_paise: 118_000,
      notes: 'Customer returned damaged goods',
      business: {
        legal_name: 'Chandigarh Goods Ltd',
        gstin: `${sellerState}AABCU9603R1ZM`,
        state_code: sellerState,
        city: 'Chandigarh',
      },
      originalInvoice: {
        id: 'orig-inv-1',
        invoice_number: 'INV-2026-0099',
        invoice_date: '2026-05-01',
        billing_name_snapshot: 'Test Customer',
        place_of_supply_state_code: posState,
      },
      lineItems: [
        {
          ...dummyLine,
          cgst_paise: isIntra ? 9_000 : 0,
          sgst_paise: isIntra ? 9_000 : 0,
          igst_paise: isIntra ? 0 : 18_000,
        },
      ],
    };
  };

  const templates = ['template_1', 'template_2', 'template_3', 'template_4'] as const;

  describe('Invoice templates 1 to 4', () => {
    for (const templateId of templates) {
      describe(`${templateId}`, () => {
        it('renders UTGST (and no standalone SGST) for intra-state supply in UT without legislature (04)', () => {
          const invoice = createInvoice('04', '04', templateId);
          const html = renderToStaticMarkup(
            createElement(InvoicePrintView, {
              invoice,
              businessStateCode: '04',
              displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
            }),
          );

          expect(html).toContain('UTGST');
          expect(html).not.toMatch(/\bSGST\b/);
        });

        it('renders SGST (and not UTGST) for intra-state supply in state (27)', () => {
          const invoice = createInvoice('27', '27', templateId);
          const html = renderToStaticMarkup(
            createElement(InvoicePrintView, {
              invoice,
              businessStateCode: '27',
              displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
            }),
          );

          expect(html).toContain('SGST');
          expect(html).not.toContain('UTGST');
        });

        it('renders IGST (and neither SGST nor UTGST as tax line) for inter-state supply (04 -> 27)', () => {
          const invoice = createInvoice('04', '27', templateId);
          const html = renderToStaticMarkup(
            createElement(InvoicePrintView, {
              invoice,
              businessStateCode: '04',
              displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
            }),
          );

          expect(html).toContain('IGST');
          expect(html).not.toContain('UTGST');
          expect(html).not.toMatch(/\bSGST\b/);
        });
      });
    }
  });

  describe('Credit note print view', () => {
    it('renders UTGST (and no standalone SGST) for intra-state supply in UT without legislature (04)', () => {
      const creditNote = createCreditNote('04', '04');
      const html = renderToStaticMarkup(
        createElement(CreditNotePrintView, { creditNote }),
      );

      expect(html).toContain('UTGST');
      expect(html).not.toMatch(/\bSGST\b/);
    });

    it('renders SGST (and not UTGST) for intra-state supply in state (27)', () => {
      const creditNote = createCreditNote('27', '27');
      const html = renderToStaticMarkup(
        createElement(CreditNotePrintView, { creditNote }),
      );

      expect(html).toContain('SGST');
      expect(html).not.toContain('UTGST');
    });

    it('renders IGST (and neither SGST nor UTGST as tax line) for inter-state supply (04 -> 27)', () => {
      const creditNote = createCreditNote('04', '27');
      const html = renderToStaticMarkup(
        createElement(CreditNotePrintView, { creditNote }),
      );

      expect(html).toContain('IGST');
      expect(html).not.toContain('UTGST');
      expect(html).not.toMatch(/\bSGST\b/);
    });
  });
});
