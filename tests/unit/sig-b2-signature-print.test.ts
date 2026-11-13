import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { CreditNotePrintView, type CreditNotePrintViewProps } from '@/components/app/credit-notes/credit-note-print-view';
import { SignatureMark, isSignatureDataUri } from '@/components/app/invoices/templates/signature-mark';
import { buildPreviewInvoiceData } from '@/components/app/invoices/invoice-form/form-calculations';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';
import type { CurrentBusiness } from '@/lib/auth/current-business';

const SIG = 'data:image/png;base64,iVBORw0KGgo=';

const dummyInvoice = {
  id: 'inv-test-1',
  business_name: 'Test Business Pvt Ltd',
  city: 'Mumbai',
  seller_gstin_snapshot: '27AABCU9603R1ZM',
  phone: '9876543210',
  bank_name: 'State Bank of India',
  bank_account_number: '12345678901',
  bank_ifsc: 'SBIN0001234',
  invoice_terms: 'Payment due on receipt\nSubject to local jurisdiction\nGoods once sold cannot be returned',
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

describe('SIG-B2: Authorised signature template printing', () => {
  for (const templateId of templates) {
    describe(`${templateId}`, () => {
      it('a) showSignatory true + signature_data_uri SIG -> contains img, alt, Authorised Signatory, and business name', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: { ...dummyInvoice, invoice_template: templateId, signature_data_uri: SIG },
            businessStateCode: '27',
            displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showSignatory: true },
          }),
        );
        expect(html).toContain(`src="${SIG}"`);
        expect(html).toContain('alt="Authorised signature"');
        expect(html).toContain('Authorised Signatory');
        expect(html).toContain('For Test Business Pvt Ltd');
      });

      it('b) showSignatory true + no signature -> no alt, still contains Authorised Signatory and business name (and STAMP for templates 2-4)', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: { ...dummyInvoice, invoice_template: templateId, signature_data_uri: null },
            businessStateCode: '27',
            displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showSignatory: true },
          }),
        );
        expect(html).not.toContain('alt="Authorised signature"');
        expect(html).toContain('Authorised Signatory');
        expect(html).toContain('For Test Business Pvt Ltd');

        if (templateId !== 'template_1') {
          expect(html).toContain('STAMP / SIGNATURE');
        }
      });

      it('c) showSignatory false + signature SIG -> contains none of img, Authorised Signatory, business name, or STAMP', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: { ...dummyInvoice, invoice_template: templateId, signature_data_uri: SIG },
            businessStateCode: '27',
            displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showSignatory: false },
          }),
        );
        expect(html).not.toContain('alt="Authorised signature"');
        expect(html).not.toContain('Authorised Signatory');
        expect(html).not.toContain('For Test Business Pvt Ltd');
        expect(html).not.toContain('STAMP / SIGNATURE');
      });

      it('d) signature_data_uri = https://evil.example/x.png -> no img alt (SignatureMark rejects non-data URIs)', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: { ...dummyInvoice, invoice_template: templateId, signature_data_uri: 'https://evil.example/x.png' },
            businessStateCode: '27',
            displayPrefs: { ...DEFAULT_INVOICE_DISPLAY_PREFS, showSignatory: true },
          }),
        );
        expect(html).not.toContain('alt="Authorised signature"');
        expect(html).not.toContain('https://evil.example/x.png');
      });
    });
  }

  describe('SignatureMark and isSignatureDataUri', () => {
    it('validates PNG base64 data URIs correctly', () => {
      expect(isSignatureDataUri(SIG)).toBe(true);
      expect(isSignatureDataUri('')).toBe(false);
      expect(isSignatureDataUri(null)).toBe(false);
      expect(isSignatureDataUri(undefined)).toBe(false);
      expect(isSignatureDataUri('data:image/png;base64,')).toBe(false);
      expect(isSignatureDataUri('data:image/svg+xml;base64,AAAA')).toBe(false);
      expect(isSignatureDataUri('https://x')).toBe(false);
    });

    it('SignatureMark renders img only for valid data URIs', () => {
      const validHtml = renderToStaticMarkup(createElement(SignatureMark, { src: SIG }));
      expect(validHtml).toContain('<img');
      expect(validHtml).toContain('alt="Authorised signature"');

      const evilHtml = renderToStaticMarkup(createElement(SignatureMark, { src: 'https://x' }));
      expect(evilHtml).toBe('');

      const nullHtml = renderToStaticMarkup(createElement(SignatureMark, { src: null }));
      expect(nullHtml).toBe('');
    });
  });

  describe('Credit note print view', () => {
    const createCreditNoteFixture = (signatureDataUri?: string | null): CreditNotePrintViewProps['creditNote'] => ({
      id: 'cn-1',
      credit_note_number: 'CN-2026-0001',
      issue_date: '2026-05-01',
      reason: '01-Sales Return',
      subtotal_paise: 100000,
      total_cgst_paise: 9000,
      total_sgst_paise: 9000,
      total_igst_paise: 0,
      total_tax_paise: 18000,
      grand_total_paise: 118000,
      business: {
        legal_name: 'Chandigarh Goods Ltd',
        gstin: '27AABCU9603R1ZM',
        state_code: '27',
        city: 'Mumbai',
        signature_data_uri: signatureDataUri,
      },
      originalInvoice: {
        id: 'orig-inv-1',
        invoice_number: 'INV-2026-0099',
        invoice_date: '2026-04-01',
        place_of_supply_state_code: '27',
      },
      lineItems: [
        {
          id: 'li-1',
          description: 'Consulting Services',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
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
    });

    it('with business.signature_data_uri SIG -> contains img and Authorised Signatory, never Authorized Signatory', () => {
      const creditNote = createCreditNoteFixture(SIG);
      const html = renderToStaticMarkup(createElement(CreditNotePrintView, { creditNote }));
      expect(html).toContain(`src="${SIG}"`);
      expect(html).toContain('alt="Authorised signature"');
      expect(html).toContain('Authorised Signatory');
      expect(html).not.toContain('Authorized Signatory');
    });

    it('without signature -> no img, still contains Authorised Signatory, never Authorized Signatory', () => {
      const creditNote = createCreditNoteFixture(null);
      const html = renderToStaticMarkup(createElement(CreditNotePrintView, { creditNote }));
      expect(html).not.toContain('alt="Authorised signature"');
      expect(html).toContain('Authorised Signatory');
      expect(html).not.toContain('Authorized Signatory');
    });
  });

  describe('buildPreviewInvoiceData', () => {
    const dummyBusiness = {
      id: 'biz-1',
      legal_name: 'Test Business',
      city: 'Mumbai',
      gstin: '27AABCU9603R1ZM',
      phone: '9876543210',
      nature_of_business: null,
      alternate_phone: null,
      address_line1: '123 Test St',
      address_line2: null,
      pincode: '400001',
      bank_name: null,
      bank_account_number: null,
      bank_ifsc: null,
      invoice_terms: null,
      logo_storage_key: null,
      subscription_plan: 'free',
      subscription_status: 'active',
      trial_ends_at: null,
    } as unknown as CurrentBusiness;

    it('maps signatureDataUri when provided', () => {
      const result = buildPreviewInvoiceData({
        business: dummyBusiness,
        watchLineItems: [],
        watchPlaceOfSupplyState: '27',
        watchBillingName: 'Customer Acme',
        watchBillingGstin: '',
        watchInvoiceDate: '2026-04-01',
        watchTemplate: 'template_1',
        gstRateTypeVal: 'exclusive',
        taxRates: [],
        selectedCustomer: null,
        invoiceNumberFormatPreview: 'INV-001',
        signatureDataUri: SIG,
      });

      expect(result.signature_data_uri).toBe(SIG);
    });

    it('maps signature_data_uri to null when signatureDataUri is omitted or undefined', () => {
      const result = buildPreviewInvoiceData({
        business: dummyBusiness,
        watchLineItems: [],
        watchPlaceOfSupplyState: '27',
        watchBillingName: 'Customer Acme',
        watchBillingGstin: '',
        watchInvoiceDate: '2026-04-01',
        watchTemplate: 'template_1',
        gstRateTypeVal: 'exclusive',
        taxRates: [],
        selectedCustomer: null,
        invoiceNumberFormatPreview: 'INV-001',
      });

      expect(result.signature_data_uri).toBeNull();
    });
  });
});

