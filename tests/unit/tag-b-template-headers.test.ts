import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TaglinePill,
  resolveHeaderSubline,
  ContactLine,
} from '@/components/app/invoices/templates/header-parts';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

describe('TAG-B: Header Parts pure components and helpers', () => {
  describe('resolveHeaderSubline', () => {
    it('prioritizes tagline over nature of business', () => {
      const res = resolveHeaderSubline({
        invoice_tagline: 'WHOLESALERS & RETAILERS',
        nature_of_business: 'Wholesale & Retail',
      });
      expect(res).toEqual({
        kind: 'tagline',
        text: 'WHOLESALERS & RETAILERS',
      });
    });

    it('returns nature when tagline is missing or undefined', () => {
      const res = resolveHeaderSubline({
        invoice_tagline: null,
        nature_of_business: 'Wholesale & Retail',
      });
      expect(res).toEqual({
        kind: 'nature',
        text: 'Wholesale & Retail',
      });
    });

    it('treats whitespace-only tagline as empty and falls back to nature', () => {
      const res = resolveHeaderSubline({
        invoice_tagline: '   \n  \t  ',
        nature_of_business: 'Wholesale & Retail',
      });
      expect(res).toEqual({
        kind: 'nature',
        text: 'Wholesale & Retail',
      });
    });

    it('treats whitespace-only nature as empty and returns null if no tagline', () => {
      const res = resolveHeaderSubline({
        invoice_tagline: '   ',
        nature_of_business: '  \t  ',
      });
      expect(res).toBeNull();
    });

    it('returns null when both are missing or empty', () => {
      expect(resolveHeaderSubline({})).toBeNull();
      expect(resolveHeaderSubline({ invoice_tagline: null, nature_of_business: null })).toBeNull();
    });
  });

  describe('TaglinePill', () => {
    it('uses text-[12px] for text length <= 60 chars', () => {
      const text60 = 'A'.repeat(60);
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: text60, tone: 'black' }));
      expect(html).toContain('text-[12px]');
      expect(html).not.toContain('text-[11px]');
    });

    it('uses text-[11px] for text length >= 61 chars', () => {
      const text61 = 'A'.repeat(61);
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: text61, tone: 'black' }));
      expect(html).toContain('text-[11px]');
      expect(html).not.toContain('text-[12px]');
    });

    it('applies black tone classes correctly', () => {
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: 'TEXT', tone: 'black' }));
      expect(html).toContain('border-black text-black');
    });

    it('applies blue tone classes correctly', () => {
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: 'TEXT', tone: 'blue' }));
      expect(html).toContain('border-[#0e3f94] text-[#0e3f94]');
    });

    it('applies slate tone classes correctly', () => {
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: 'TEXT', tone: 'slate' }));
      expect(html).toContain('border-slate-400 text-slate-800');
    });

    it('never renders when text is empty', () => {
      const html = renderToStaticMarkup(createElement(TaglinePill, { text: '', tone: 'black' }));
      expect(html).toBe('');
    });
  });

  describe('ContactLine', () => {
    it('renders address and phones separated by diamond when both exist', () => {
      const html = renderToStaticMarkup(
        createElement(ContactLine, {
          address: '123 Main St, Mumbai - 400001',
          phones: ['9876543210', '9123456780'],
          className: 'contact-cls',
        }),
      );
      expect(html).toContain('123 Main St, Mumbai - 400001');
      expect(html).toContain('◆');
      // The diamond and the phone text live in ONE unbreakable span, so a wrap never strands the diamond.
      const nowrap = html.match(/<span class="whitespace-nowrap">([\s\S]*?Ph No\.: 9876543210, 9123456780)<\/span>/);
      expect(nowrap).not.toBeNull();
      expect(nowrap![1]).toContain('◆');
      expect(html.indexOf('123 Main St')).toBeLessThan(html.indexOf('◆'));
      expect(html).toContain('class="contact-cls"');
    });

    it('renders phones only with no diamond separator', () => {
      const html = renderToStaticMarkup(
        createElement(ContactLine, {
          address: '',
          phones: ['9876543210'],
        }),
      );
      expect(html).toContain('Ph No.: 9876543210');
      expect(html).not.toContain('◆');
    });

    it('renders address only with no diamond separator', () => {
      const html = renderToStaticMarkup(
        createElement(ContactLine, {
          address: '123 Main St, Mumbai - 400001.',
          phones: [],
        }),
      );
      expect(html).toContain('123 Main St, Mumbai - 400001.');
      expect(html).not.toContain('◆');
      expect(html).not.toContain('Ph No.');
    });

    it('renders nothing when both address and phones are empty', () => {
      const html = renderToStaticMarkup(
        createElement(ContactLine, {
          address: '   ',
          phones: ['', '   '],
        }),
      );
      expect(html).toBe('');
    });
  });
});

describe('TAG-B: Template Headers rendering', () => {
  const dummyInvoice = {
    id: 'inv-test-1',
    business_name: 'Acme Enterprises',
    address_line1: '123 MG Road',
    address_line2: 'Suite 4B',
    city: 'Bengaluru',
    pincode: '560001',
    seller_gstin_snapshot: '29AABCU9603R1ZM',
    phone: '9876543210',
    alternate_phone: '9123456780',
    bank_name: 'State Bank of India',
    bank_account_number: '12345678901',
    bank_ifsc: 'SBIN0001234',
    invoice_terms: 'Payment due on receipt',
    invoice_number: 'INV-2026-0001',
    invoice_date: '2026-04-01',
    billing_name_snapshot: 'Customer Acme',
    billing_gstin_snapshot: '29AABCU9603R1ZM',
    billing_address_snapshot: '456 Commercial Rd',
    place_of_supply_state_code: '29',
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

  const pillTemplates = ['template_2', 'template_3', 'template_4'] as const;

  for (const templateId of pillTemplates) {
    describe(`${templateId} tagline pill & contact header`, () => {
      it('a) renders tagline pill and does NOT render nature when both are present', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: {
              ...dummyInvoice,
              invoice_template: templateId,
              invoice_tagline: 'WHOLESALERS & RETAILERS OF TEXT BOOKS',
              nature_of_business: 'Wholesale & Retail',
            },
            businessStateCode: '29',
            displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
          }),
        );

        // Tagline is inside rounded-full element
        expect(html).toContain('WHOLESALERS &amp; RETAILERS OF TEXT BOOKS');
        expect(html).toContain('rounded-full');
        expect(html).not.toContain('(Wholesale &amp; Retail)');
        expect(html).not.toContain('(Wholesale & Retail)');
      });

      it('b) renders nature of business and NO tagline pill when tagline is absent', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: {
              ...dummyInvoice,
              invoice_template: templateId,
              invoice_tagline: null,
              nature_of_business: 'Wholesale & Retail',
            },
            businessStateCode: '29',
            displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
          }),
        );

        expect(html).toContain('(Wholesale &amp; Retail)');
        expect(html).not.toContain('WHOLESALERS');
        // No TaglinePill pill
        expect(html).not.toMatch(/rounded-full[^>]*>[^<]*WHOLESALERS/);
      });

      it('c) renders neither when neither tagline nor nature is present', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: {
              ...dummyInvoice,
              invoice_template: templateId,
              invoice_tagline: null,
              nature_of_business: null,
            },
            businessStateCode: '29',
            displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
          }),
        );

        expect(html).not.toContain('WHOLESALERS');
        expect(html).not.toContain('(Wholesale');
      });

      it('d) renders phone number in the SAME <p> as the address after ◆', () => {
        const html = renderToStaticMarkup(
          createElement(InvoicePrintView, {
            invoice: {
              ...dummyInvoice,
              invoice_template: templateId,
              invoice_tagline: 'WHOLESALERS & RETAILERS',
            },
            businessStateCode: '29',
            displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
          }),
        );

        // Match a <p ...> containing both the address and Ph No. separated by ◆
        const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/g);
        expect(match).not.toBeNull();
        const contactP = match?.find((p) => p.includes('◆') && p.includes('Ph No.:'));
        expect(contactP).toBeDefined();
        expect(contactP).toContain('BENGALURU');
        expect(contactP).toContain('Ph No.: 9876543210, 9123456780');
      });
    });
  }

  describe('template_1 tagline isolation', () => {
    it('output is identical with or without tagline, tagline never shown, nature preserved', () => {
      const htmlWithout = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: {
            ...dummyInvoice,
            invoice_template: 'template_1',
            invoice_tagline: null,
            nature_of_business: 'Wholesale & Retail',
          },
          businessStateCode: '29',
          displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
        }),
      );

      const htmlWith = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: {
            ...dummyInvoice,
            invoice_template: 'template_1',
            invoice_tagline: 'WHOLESALERS & RETAILERS OF TEXT BOOKS',
            nature_of_business: 'Wholesale & Retail',
          },
          businessStateCode: '29',
          displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
        }),
      );

      expect(htmlWith).toBe(htmlWithout);
      expect(htmlWith).toContain('(Wholesale &amp; Retail)');
      expect(htmlWith).not.toContain('WHOLESALERS');
    });
  });

  describe('template_4 GSTIN card layout', () => {
    it('GSTIN appears BEFORE TAX INVOICE in markup, right card contains Invoice No and Date but not GSTIN', () => {
      const html = renderToStaticMarkup(
        createElement(InvoicePrintView, {
          invoice: {
            ...dummyInvoice,
            invoice_template: 'template_4',
            seller_gstin_snapshot: '29AABCU9603R1ZM',
            invoice_number: 'INV-2026-9999',
            invoice_date: '2026-05-15',
          },
          businessStateCode: '29',
          displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
        }),
      );

      const gstinIndex = html.indexOf('GSTIN');
      const taxInvoiceIndex = html.indexOf('TAX INVOICE');
      expect(gstinIndex).toBeGreaterThan(-1);
      expect(taxInvoiceIndex).toBeGreaterThan(-1);
      expect(gstinIndex).toBeLessThan(taxInvoiceIndex);

      // Inspect the right meta card: it should contain Invoice No and Date, but not GSTIN
      const rightCardStart = html.indexOf('min-w-[205px]');
      expect(rightCardStart).toBeGreaterThan(-1);
      const rightCardHtml = html.slice(rightCardStart, rightCardStart + 500);
      expect(rightCardHtml).toContain('Invoice No');
      expect(rightCardHtml).toContain('INV-2026-9999');
      expect(rightCardHtml).toContain('Date');
      expect(rightCardHtml).not.toContain('GSTIN');
    });
  });
});
