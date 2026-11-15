// HDR redesign guards: Templates 2, 3 and 4 share one header system (components/app/invoices/templates/header-parts.tsx).
// Layout quality (centring, gaps, overlaps) was verified by measuring 180 rendered variants in a browser;
// these tests lock in the rules so they can't drift back.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrandLockup } from '@/components/app/invoices/templates/header-parts';
import { InvoicePrintView } from '@/components/app/invoices/invoice-print-view';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

// Name line breaks and sizes are width-based since the name-fit refinement: see tests/unit/brand-name-fit.test.ts.

describe('HDR: BrandLockup', () => {
  it('renders the logo in the standard 52px box (fit, never cropped) beside the name', () => {
    const html = renderToStaticMarkup(createElement(BrandLockup, { logoSrc: LOGO, name: 'ACME CO', nameClassName: 'text-black' }));
    expect(html).toContain('data-hdr="lockup"');
    expect(html).toMatch(/data-hdr="logo"[^>]*class="[^"]*h-\[52px\][^"]*max-w-\[156px\]/);
    expect(html).toMatch(/<img[^>]*class="[^"]*object-contain/);
    expect(html).not.toContain('overflow-hidden');
    expect(html.indexOf('data-hdr="logo"')).toBeLessThan(html.indexOf('data-hdr="name"'));
  });

  it('renders no logo box when there is no logo', () => {
    const html = renderToStaticMarkup(createElement(BrandLockup, { logoSrc: null, name: 'ACME CO', nameClassName: 'text-black' }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data-hdr="logo"');
    expect(html).toContain('ACME CO');
  });
});

describe('HDR: Templates 2, 3 and 4 use the shared header system', () => {
  const invoice = {
    id: 'inv-hdr',
    business_name: 'Brajesh Kumar Clothing',
    address_line1: '1123, Financial District',
    city: 'Delhi',
    pincode: '533317',
    seller_gstin_snapshot: '37ABCDE1234L1Z1',
    phone: '9513573562',
    bank_name: null,
    bank_account_number: null,
    bank_ifsc: null,
    invoice_terms: null,
    invoice_number: 'BMA/2026-27/0003',
    invoice_date: '2026-11-14',
    billing_name_snapshot: null,
    billing_gstin_snapshot: null,
    billing_address_snapshot: null,
    place_of_supply_state_code: '37',
    subtotal_paise: 0,
    total_cgst_paise: 0,
    total_sgst_paise: 0,
    total_igst_paise: 0,
    total_tax_paise: 0,
    grand_total_paise: 0,
    logo_base64: LOGO,
    lineItems: [],
  };
  const render = (template: string) =>
    renderToStaticMarkup(
      createElement(InvoicePrintView, {
        invoice: { ...invoice, invoice_template: template },
        businessStateCode: '37',
        displayPrefs: DEFAULT_INVOICE_DISPLAY_PREFS,
      }),
    );

  for (const template of ['template_2', 'template_3', 'template_4']) {
    it(`${template}: header rows in order, logo inside the centred group, thin dividers, no old hacks`, () => {
      const html = render(template);
      const order = ['data-hdr="header"', 'data-hdr="meta"', 'TAX INVOICE', 'data-hdr="lockup"', 'data-hdr="logo"', 'data-hdr="name"', 'Ph No.:'];
      const positions = order.map((marker) => html.indexOf(marker));
      positions.forEach((p, i) => expect(p, order[i]).toBeGreaterThan(-1));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // The business name is shown in capitals (by CSS) and is never cut.
      expect(html).toContain('Brajesh Kumar Clothing');
      expect(html).not.toContain('◆');
      expect(html).not.toContain('right-full'); // old "hanging" logo
      expect(html).not.toContain('translateX(-1cm)'); // old Template 2 shift
      expect(html).not.toContain('left-[-7px]'); // old Template 4 nudge
      expect(html).toContain('w-px');
    });
  }

  it('the logo box is identical in all three templates', () => {
    const boxes = ['template_2', 'template_3', 'template_4'].map((t) => render(t).match(/<div data-hdr="logo"[^>]*>/)?.[0]);
    expect(boxes[0]).toBeDefined();
    expect(new Set(boxes).size).toBe(1);
  });

  it('Template 3 keeps its Date in the buyer row, not in the header', () => {
    const html = render('template_3');
    const headerEnd = html.indexOf('</header>');
    expect(html.slice(0, headerEnd)).not.toContain('14/11/2026');
    expect(html.slice(headerEnd)).toContain('14/11/2026');
  });

  it('Template 1 is untouched by the shared header system', () => {
    const html = render('template_1');
    expect(html).not.toContain('data-hdr=');
  });

  it('the header source files keep the shared parts (no per-template logo boxes)', () => {
    for (const file of ['template-2.tsx', 'template-3.tsx', 'template-4.tsx']) {
      const src = readFileSync(join(process.cwd(), 'components/app/invoices/templates', file), 'utf8');
      expect(src, file).toContain('<BrandLockup');
      expect(src, file).toContain('<ContactLine');
      expect(src, file).not.toMatch(/<img/);
    }
  });
});
