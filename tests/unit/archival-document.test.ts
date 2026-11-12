import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoices, invoiceLineItems, creditNotes, creditNoteLineItems } from '@/lib/db/schema';
import { buildArchivalHtml, ArchivalDocumentError } from '@/lib/pdf/archival-document';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let invoiceStore: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let invoiceLineItemsStore: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let creditNoteStore: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let creditNoteLineItemsStore: any[] = [];

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const resolveTable = () => {
            if (table === invoices) return invoiceStore;
            if (table === invoiceLineItems) return invoiceLineItemsStore;
            if (table === creditNotes) return creditNoteStore;
            if (table === creditNoteLineItems) return creditNoteLineItemsStore;
            return [];
          };
          return {
            orderBy: () => Promise.resolve(resolveTable()),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            then: (onfulfilled?: (val: any) => any, onrejected?: (err: any) => any) =>
              Promise.resolve(resolveTable()).then(onfulfilled, onrejected),
          };
        },
      }),
    }),
  },
}));

const mockLoadLogoDataUri = vi.fn();
vi.mock('@/lib/storage/logo', () => ({
  loadLogoDataUri: (...args: unknown[]) => mockLoadLogoDataUri(...args),
}));

const SAMPLE_INVOICE = {
  id: 'inv-12345678-0001',
  business_id: 'biz-12345678-0001',
  invoice_number: 'INV-2024-25-0001',
  invoice_date: '2024-04-10',
  due_date: '2024-04-25',
  lifecycle_status: 'finalized',
  has_watermark: true,
  seller_gstin_snapshot: '27AABCU9603R1ZM',
  seller_name_snapshot: 'Acme Technologies Private Limited',
  seller_trade_name_snapshot: 'Acme Tech',
  seller_address_snapshot: {
    line1: '101 Technopark',
    line2: 'MIDC',
    city: 'Mumbai',
    pincode: '400093',
  },
  seller_state_code_snapshot: '27',
  seller_phone_snapshot: '9876543210',
  seller_alternate_phone_snapshot: null,
  seller_email_snapshot: 'billing@acmetech.com',
  seller_nature_of_business_snapshot: null,
  seller_pan_snapshot: 'AABCU9603R',
  seller_bank_snapshot: {
    accountName: 'Acme Technologies',
    accountNumber: '1234567890',
    ifsc: 'HDFC0001234',
    bankName: 'HDFC Bank',
  },
  terms_snapshot: 'Payment due within 15 days.',
  logo_storage_key_snapshot: 'logos/biz-12345678-0001/logo.png',
  display_prefs_snapshot: null,
  customer_id: 'cust-12345678-0001',
  billing_name_snapshot: 'Beta Retailers Private Limited',
  billing_gstin_snapshot: '27BBBCE1234F1Z5',
  place_of_supply_state_code: '27',
  subtotal_paise: 100000,
  total_taxable_paise: 100000,
  total_tax_paise: 18000,
  total_cgst_paise: 9000,
  total_sgst_paise: 9000,
  total_igst_paise: 0,
  round_off_paise: 0,
  grand_total_paise: 118000,
  notes: 'Thank you for your business',
  terms_and_conditions: 'Standard terms apply',
};

const SAMPLE_INVOICE_LINE_ITEMS = [
  {
    id: 'li-1',
    invoice_id: 'inv-12345678-0001',
    description: 'Cloud Consulting Services',
    hsn_code: '998313',
    quantity: '1',
    unit_price_paise: 100000,
    taxable_amount_paise: 100000,
    gst_rate: '18',
    cgst_amount_paise: 9000,
    sgst_amount_paise: 9000,
    igst_amount_paise: 0,
    total_amount_paise: 118000,
    sort_order: 1,
  },
];

const SAMPLE_CREDIT_NOTE = {
  id: 'cn-12345678-0001',
  business_id: 'biz-12345678-0001',
  credit_note_number: 'CN-2024-25-0001',
  issue_date: '2024-04-15',
  lifecycle_status: 'finalized',
  reason: 'Deficiency in services',
  original_invoice_id: 'inv-12345678-0001',
  seller_gstin_snapshot: '27AABCU9603R1ZM',
  seller_name_snapshot: 'Acme Technologies Private Limited',
  seller_trade_name_snapshot: 'Acme Tech',
  seller_address_snapshot: {
    line1: '101 Technopark',
    line2: 'MIDC',
    city: 'Mumbai',
    pincode: '400093',
  },
  seller_state_code_snapshot: '27',
  seller_phone_snapshot: '9876543210',
  seller_alternate_phone_snapshot: null,
  seller_email_snapshot: 'billing@acmetech.com',
  seller_nature_of_business_snapshot: null,
  seller_pan_snapshot: 'AABCU9603R',
  seller_bank_snapshot: null,
  terms_snapshot: null,
  logo_storage_key_snapshot: null,
  subtotal_paise: 20000,
  total_taxable_paise: 20000,
  total_tax_paise: 3600,
  total_cgst_paise: 1800,
  total_sgst_paise: 1800,
  total_igst_paise: 0,
  round_off_paise: 0,
  grand_total_paise: 23600,
};

const SAMPLE_CREDIT_NOTE_LINE_ITEMS = [
  {
    id: 'cn-li-1',
    credit_note_id: 'cn-12345678-0001',
    description: 'Cloud Consulting Discount',
    hsn_code: '998313',
    quantity: '1',
    unit_price_paise: 20000,
    taxable_amount_paise: 20000,
    taxable_value_paise: 20000,
    gst_rate: '18',
    cgst_amount_paise: 1800,
    cgst_paise: 1800,
    sgst_amount_paise: 1800,
    sgst_paise: 1800,
    igst_amount_paise: 0,
    igst_paise: 0,
    total_amount_paise: 23600,
    line_total_paise: 23600,
    sort_order: 1,
  },
];

describe('buildArchivalHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceStore = [{ ...SAMPLE_INVOICE }];
    invoiceLineItemsStore = [...SAMPLE_INVOICE_LINE_ITEMS];
    creditNoteStore = [{ ...SAMPLE_CREDIT_NOTE }];
    creditNoteLineItemsStore = [...SAMPLE_CREDIT_NOTE_LINE_ITEMS];
    mockLoadLogoDataUri.mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  });

  it('Case 1: buildArchivalHtml("invoice", validId) returns valid HTML and title', async () => {
    const { html, title } = await buildArchivalHtml('invoice', 'inv-12345678-0001');

    expect(title).toBe('Invoice INV-2024-25-0001');
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<html');
    expect(html).toContain('<body');
    expect(html).toContain('<title>Invoice INV-2024-25-0001</title>');
    expect(html).toContain('INV-2024-25-0001');
    expect(html).toContain('Beta Retailers Private Limited');
    expect(html).toContain('Acme Technologies Private Limited');
    expect(html).toContain('27AABCU9603R1ZM');
    expect(html).toContain('27BBBCE1234F1Z5');
    expect(html).toContain('Generated via Invoice BizFolio (Free Tier)');
    // Injected print stylesheet
    expect(html).toContain('<style>');
  });

  it('Case 2: buildArchivalHtml("credit_note", validId) returns valid HTML and title', async () => {
    const { html, title } = await buildArchivalHtml('credit_note', 'cn-12345678-0001');

    expect(title).toBe('Credit Note CN-2024-25-0001');
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<title>Credit Note CN-2024-25-0001</title>');
    expect(html).toContain('CN-2024-25-0001');
    expect(html).toContain('INV-2024-25-0001'); // original invoice reference
    expect(html).toContain('Generated by Invoice BizFolio Billing System');
    expect(html).toContain('<style>');
  });

  it('Case 3: Document not found throws ArchivalDocumentError with reason "not_found"', async () => {
    invoiceStore = [];
    await expect(buildArchivalHtml('invoice', 'non-existent-id')).rejects.toThrow(ArchivalDocumentError);
    await expect(buildArchivalHtml('invoice', 'non-existent-id')).rejects.toMatchObject({
      name: 'ArchivalDocumentError',
      reason: 'not_found',
      failure: 'not_found',
    });

    creditNoteStore = [];
    await expect(buildArchivalHtml('credit_note', 'non-existent-id')).rejects.toThrow(ArchivalDocumentError);
    await expect(buildArchivalHtml('credit_note', 'non-existent-id')).rejects.toMatchObject({
      name: 'ArchivalDocumentError',
      reason: 'not_found',
      failure: 'not_found',
    });
  });

  it('Case 4: Document not finalized throws ArchivalDocumentError with reason "not_finalized"', async () => {
    invoiceStore = [{ ...SAMPLE_INVOICE, lifecycle_status: 'draft' }];
    await expect(buildArchivalHtml('invoice', 'inv-12345678-0001')).rejects.toThrow(ArchivalDocumentError);
    await expect(buildArchivalHtml('invoice', 'inv-12345678-0001')).rejects.toMatchObject({
      name: 'ArchivalDocumentError',
      reason: 'not_finalized',
      failure: 'not_finalized',
    });

    creditNoteStore = [{ ...SAMPLE_CREDIT_NOTE, lifecycle_status: 'draft' }];
    await expect(buildArchivalHtml('credit_note', 'cn-12345678-0001')).rejects.toThrow(ArchivalDocumentError);
    await expect(buildArchivalHtml('credit_note', 'cn-12345678-0001')).rejects.toMatchObject({
      name: 'ArchivalDocumentError',
      reason: 'not_finalized',
      failure: 'not_finalized',
    });
  });

  it('Case 5: loads logo data URI when storage key is present, and handles null gracefully without throwing', async () => {
    // When logo exists
    const withLogo = await buildArchivalHtml('invoice', 'inv-12345678-0001');
    expect(mockLoadLogoDataUri).toHaveBeenCalledWith('logos/biz-12345678-0001/logo.png');
    expect(withLogo.html).toContain('data:image/png;base64,');

    // When logo loading returns null
    mockLoadLogoDataUri.mockResolvedValueOnce(null);
    const withoutLogo = await buildArchivalHtml('invoice', 'inv-12345678-0001');
    expect(withoutLogo.html).not.toContain('data:image/png;base64,');
    expect(withoutLogo.title).toBe('Invoice INV-2024-25-0001');
  });

  it('Case 6: Snapshot data precedence: outputs frozen snapshot values and does not alter based on live data', async () => {
    invoiceStore = [
      {
        ...SAMPLE_INVOICE,
        seller_name_snapshot: 'Frozen Historic Corp Name',
      },
    ];

    const { html } = await buildArchivalHtml('invoice', 'inv-12345678-0001');
    expect(html).toContain('Frozen Historic Corp Name');
    expect(html).not.toContain('Acme Technologies Private Limited');
  });
});
