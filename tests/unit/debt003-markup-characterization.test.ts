import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CurrentBusiness } from '@/lib/auth/current-business';
import type { CustomerOption } from '@/lib/pickers/types';
import type { UpiPaymentsMap } from '@/lib/payments/types';
import type { taxRates, financialYears } from '@/lib/db/schema';
import { InvoiceForm, type InvoiceFormInitialData } from '@/components/app/invoices/invoice-form';
import { CheckoutForm } from '@/app/(app)/checkout/checkout-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/invoices/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/actions/invoices/save-invoice-draft', () => ({
  saveInvoiceDraft: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/finalize-invoice', () => ({
  finalizeInvoice: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/get-next-sequence', () => ({
  getNextSequenceForDate: vi.fn(),
}));
vi.mock('@/lib/actions/customers/search-customer-options', () => ({
  searchCustomerOptions: vi.fn(),
}));
vi.mock('@/lib/actions/products/search-product-options', () => ({
  searchProductOptions: vi.fn(),
}));
vi.mock('@/lib/actions/invoices/delete-invoice-draft', () => ({
  deleteInvoiceDraft: vi.fn(),
}));
vi.mock('@/lib/actions/subscriptions/submit-payment-claim', () => ({
  submitPaymentClaim: vi.fn(),
}));

function normalizeReactIds(html: string): string {
  const map = new Map<string, string>();
  return html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|_R_[0-9a-zA-Z]+_/g, (match) => {
    let assigned = map.get(match);
    if (!assigned) {
      assigned = `rid-${map.size + 1}`;
      map.set(match, assigned);
    }
    return assigned;
  });
}

describe('DEBT-003 Markup Characterization Snapshot', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T06:30:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const taxRatesFixture: (typeof taxRates.$inferSelect)[] = [
    {
      id: 'tr-0',
      label: '0%',
      rate_percentage: '0.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01T00:00:00Z'),
      updated_at: new Date('2020-01-01T00:00:00Z'),
    },
    {
      id: 'tr-5',
      label: '5%',
      rate_percentage: '5.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01T00:00:00Z'),
      updated_at: new Date('2020-01-01T00:00:00Z'),
    },
    {
      id: 'tr-12',
      label: '12%',
      rate_percentage: '12.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01T00:00:00Z'),
      updated_at: new Date('2020-01-01T00:00:00Z'),
    },
    {
      id: 'tr-18',
      label: '18%',
      rate_percentage: '18.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01T00:00:00Z'),
      updated_at: new Date('2020-01-01T00:00:00Z'),
    },
    {
      id: 'tr-28',
      label: '28%',
      rate_percentage: '28.00',
      is_active: true,
      effective_from: '2017-07-01',
      effective_to: null,
      created_at: new Date('2020-01-01T00:00:00Z'),
      updated_at: new Date('2020-01-01T00:00:00Z'),
    },
  ];

  const activeFysFixture: (typeof financialYears.$inferSelect)[] = [
    {
      id: 'fy-2026-27',
      business_id: 'biz-1',
      label: '2026-27',
      start_date: '2026-04-01',
      end_date: '2027-03-31',
      invoice_sequence_counter: 10,
      credit_note_sequence_counter: 0,
      is_current: true,
      created_at: new Date('2026-04-01T00:00:00Z'),
      updated_at: new Date('2026-04-01T00:00:00Z'),
    },
  ];

  const paidBusiness = {
    id: 'biz-1',
    legal_name: 'Acme Enterprises Pvt Ltd',
    trade_name: 'Acme Tech',
    gstin: '27AABCU9603R1ZM',
    pan: 'AABCU9603R',
    registration_type: 'regular' as const,
    address_line1: '100 Business Park',
    address_line2: 'Bandra Kurla Complex',
    city: 'Mumbai',
    state_code: '27',
    pincode: '400051',
    phone: '9876543210',
    email: 'billing@acme.com',
    logo_storage_key: null,
    bank_account_name: 'Acme Enterprises Pvt Ltd',
    bank_account_number: '1234567890',
    bank_ifsc: 'HDFC0001234',
    bank_name: 'HDFC Bank',
    invoice_terms: 'Payment due within 30 days.',
    invoice_number_format: 'BMA/{{FY}}/{{NUM}}',
    invoice_display_prefs: {},
    default_invoice_template: 'template_2',
    credit_note_number_prefix: 'CN',
    payment_due_days: 30,
    nature_of_business: 'Software Services',
    alternate_phone: null,
    default_gst_rate_type: 'exclusive' as const,
    subscription_plan: 'essentials',
    subscription_status: 'active',
    trial_ends_at: null,
    subscription_activated_at: new Date('2026-01-01T00:00:00Z'),
    subscription_ends_at: new Date('2026-12-31T00:00:00Z'),
    active_utr_no: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  } as unknown as CurrentBusiness;

  const freeBusiness = {
    ...paidBusiness,
    subscription_plan: 'free',
    subscription_status: 'active',
    default_invoice_template: 'template_2',
  } as unknown as CurrentBusiness;

  const upiConfigFixture = {
    upiId: 'billmatrix@okhdfcbank',
    upiName: 'Bill Matrix Tech Pvt Ltd',
    bankName: 'HDFC Bank',
    accName: 'Bill Matrix Technologies Private Limited',
    accNo: '50200098765432',
    ifsc: 'HDFC0001234',
  };

  const upiPaymentsFixture: UpiPaymentsMap = {
    'essentials:monthly': {
      amountPaise: 49900,
      uri: 'upi://pay?pa=billmatrix@okhdfcbank&pn=Bill%20Matrix&am=499.00&cu=INR',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg>mock-qr-essentials-monthly</svg>',
    },
    'essentials:yearly': {
      amountPaise: 499000,
      uri: 'upi://pay?pa=billmatrix@okhdfcbank&pn=Bill%20Matrix&am=4990.00&cu=INR',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg>mock-qr-essentials-yearly</svg>',
    },
    'professional:monthly': {
      amountPaise: 99900,
      uri: 'upi://pay?pa=billmatrix@okhdfcbank&pn=Bill%20Matrix&am=999.00&cu=INR',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg>mock-qr-prof-monthly</svg>',
    },
    'professional:yearly': {
      amountPaise: 999000,
      uri: 'upi://pay?pa=billmatrix@okhdfcbank&pn=Bill%20Matrix&am=9990.00&cu=INR',
      qrDataUrl: 'data:image/svg+xml;utf8,<svg>mock-qr-prof-yearly</svg>',
    },
  };

  const checkoutBaseBusiness = {
    id: 'biz-1',
    legal_name: 'Acme Enterprises Pvt Ltd',
    gstin: '27AABCU9603R1ZM',
    subscription_plan: 'trial',
    subscription_status: 'trial',
    subscription_activated_at: null,
    subscription_ends_at: null,
    trial_ends_at: '2026-06-30T00:00:00.000Z',
    active_utr_no: null,
  };

  it('InvoiceForm (a) new invoice, exclusive GST, intra-state, fixed invoice_date 2026-06-15', () => {
    const el = React.createElement(InvoiceForm, {
      business: paidBusiness,
      taxRates: taxRatesFixture,
      activeFys: activeFysFixture,
      isDraft: false,
      initialData: {
        invoice_date: '2026-06-15',
      },
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('InvoiceForm (b) existing draft with 3 lines on two rates, PoS 29, inclusive GST, notes, initialCustomer', () => {
    const initialCustomer: CustomerOption = {
      id: 'cust-1',
      name: 'Acme Client Corp',
      gstin: '29ABCDE1234F1Z5',
      state_code: '29',
      address_line1: '123 Tech Park',
      address_line2: 'Whitefield',
      city: 'Bengaluru',
      pincode: '560066',
      phone: '9876501234',
    };

    const initialDataDraft: InvoiceFormInitialData = {
      id: 'inv-draft-001',
      customer_id: 'cust-1',
      billing_name: 'Acme Client Corp',
      billing_gstin: '29ABCDE1234F1Z5',
      invoice_date: '2026-06-15',
      place_of_supply_state_code: '29',
      gst_rate_type: 'inclusive',
      notes: 'Draft invoice with inclusive GST rates and multiple lines.',
      invoice_template: 'template_2',
      line_items: [
        {
          product_id: '',
          description: 'Consulting Services',
          hsn_sac_code: '998311',
          quantity: 10,
          unit_of_measurement: 'HRS',
          unit_price: 1500,
          discount: 50,
          tax_rate_id: '',
        },
        {
          product_id: '',
          description: 'Implementation Support',
          hsn_sac_code: '998313',
          quantity: 5,
          unit_of_measurement: 'HRS',
          unit_price: 2000,
          discount: 0,
          tax_rate_id: '',
        },
        {
          product_id: '',
          description: 'Hardware Accessory',
          hsn_sac_code: '847130',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: 3500,
          discount: 100,
          tax_rate_id: '',
        },
      ],
    };

    const el = React.createElement(InvoiceForm, {
      business: paidBusiness,
      taxRates: taxRatesFixture,
      activeFys: activeFysFixture,
      isDraft: true,
      initialData: initialDataDraft,
      initialCustomer,
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('InvoiceForm (c) free plan business with default template_2 falling back to template_1', () => {
    const el = React.createElement(InvoiceForm, {
      business: freeBusiness,
      taxRates: taxRatesFixture,
      activeFys: activeFysFixture,
      isDraft: false,
      initialData: {
        invoice_date: '2026-06-15',
      },
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('CheckoutForm (d) trial business, no pending claim, essentials monthly', () => {
    const el = React.createElement(CheckoutForm, {
      business: checkoutBaseBusiness,
      pendingRequest: null,
      upiConfig: upiConfigFixture,
      upiPayments: upiPaymentsFixture,
      initialPlan: 'essentials',
      initialCycle: 'monthly',
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('CheckoutForm (e) initialCycle yearly', () => {
    const el = React.createElement(CheckoutForm, {
      business: checkoutBaseBusiness,
      pendingRequest: null,
      upiConfig: upiConfigFixture,
      upiPayments: upiPaymentsFixture,
      initialPlan: 'essentials',
      initialCycle: 'yearly',
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('CheckoutForm (f) expired subscription', () => {
    const el = React.createElement(CheckoutForm, {
      business: {
        ...checkoutBaseBusiness,
        subscription_plan: 'essentials',
        subscription_status: 'expired',
        subscription_activated_at: '2025-06-15T00:00:00.000Z',
        subscription_ends_at: '2026-06-01T00:00:00.000Z',
        trial_ends_at: null,
      },
      pendingRequest: null,
      upiConfig: upiConfigFixture,
      upiPayments: upiPaymentsFixture,
      initialPlan: 'essentials',
      initialCycle: 'monthly',
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('CheckoutForm (g) active subscription', () => {
    const el = React.createElement(CheckoutForm, {
      business: {
        ...checkoutBaseBusiness,
        subscription_plan: 'essentials',
        subscription_status: 'active',
        subscription_activated_at: '2026-01-01T00:00:00.000Z',
        subscription_ends_at: '2026-12-31T00:00:00.000Z',
        trial_ends_at: null,
      },
      pendingRequest: null,
      upiConfig: upiConfigFixture,
      upiPayments: upiPaymentsFixture,
      initialPlan: 'essentials',
      initialCycle: 'monthly',
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('CheckoutForm (h) pendingRequest present ("Payment Claim Under Review" screen)', () => {
    const el = React.createElement(CheckoutForm, {
      business: {
        ...checkoutBaseBusiness,
        subscription_plan: 'essentials',
        subscription_status: 'active',
      },
      pendingRequest: {
        id: 'claim-req-001',
        plan_name: 'essentials',
        billing_cycle: 'yearly',
        amount_paise: 499000,
        payment_reference: '123456789012',
        created_at: '2026-06-14T10:00:00.000Z',
      },
      upiConfig: upiConfigFixture,
      upiPayments: upiPaymentsFixture,
      initialPlan: 'essentials',
      initialCycle: 'yearly',
    });
    const html = normalizeReactIds(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });
});
