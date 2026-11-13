import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let currentPathname = '/dashboard';

// Pin env-driven contact addresses (CI sets NEXT_PUBLIC_SUPPORT_EMAIL / FEEDBACK_RECIPIENT_EMAIL) so the snapshot is the
// same on every machine. Values = the lib/config/contact.ts fallbacks the snapshot was recorded with.
vi.mock('@/lib/config/contact', () => ({
  SUPPORT_EMAIL: 'support@billmatrix.in',
  FEEDBACK_RECIPIENT_EMAIL: 'support@billmatrix.in',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

vi.mock('@/lib/actions/subscriptions/process-request', () => ({
  processSubscriptionClaim: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/update-business-subscription', () => ({
  updateBusinessSubscription: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/get-business-subscriptions', () => ({
  getBusinessSubscriptions: vi.fn(),
}));

vi.mock('@/lib/actions/subscriptions/get-claim-screenshot-url', () => ({
  getClaimScreenshotUrl: vi.fn(),
}));

vi.mock('@/lib/actions/business/admin-update-business-identity', () => ({
  adminUpdateBusinessIdentity: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: ((init?: unknown) => {
      const tab = (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__;
      if (init === 'overview' && tab) {
        return [tab, () => {}];
      }
      return actual.useState(init as never);
    }) as typeof actual.useState,
  };
});

import { AdminConsole } from '@/app/(admin)/admin/admin-console';
import { BillingTab, type SubscriptionHistoryItem } from '@/components/app/settings/billing-tab';
import { AppSidebar } from '@/components/app/app-sidebar';
import type { businesses } from '@/lib/db/schema';

function normalizeMarkup(html: string): string {
  const reactMap = new Map<string, string>();
  let out = html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|_R_[0-9a-zA-Z]+_/g, (match) => {
    let assigned = reactMap.get(match);
    if (!assigned) {
      assigned = `rid-${reactMap.size + 1}`;
      reactMap.set(match, assigned);
    }
    return assigned;
  });

  const rechartsMap = new Map<string, string>();
  out = out.replace(/recharts\d+-[a-zA-Z0-9_-]+/g, (match) => {
    let assigned = rechartsMap.get(match);
    if (!assigned) {
      assigned = `recharts-${rechartsMap.size + 1}`;
      rechartsMap.set(match, assigned);
    }
    return assigned;
  });

  return out;
}

describe('DEBT-003B Markup Characterization Snapshot', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T06:30:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    delete (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__;
    currentPathname = '/dashboard';
  });

  const upiConfigFixture = {
    upiId: 'billmatrix@okhdfcbank',
    upiName: 'Bill Matrix Tech Pvt Ltd',
    bankName: 'HDFC Bank',
    accName: 'Bill Matrix Technologies',
    accNo: '50200012345678',
    ifsc: 'HDFC0000123',
  };

  const pendingRequestsFixture = [
    {
      id: 'req-1',
      businessId: 'biz-1',
      businessName: 'Alpha Logistics Pvt Ltd',
      businessGstin: '27AABCU9603R1ZM',
      businessEmail: 'billing@alphalogistics.in',
      userId: 'user-1',
      userName: 'Aarav Sharma',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-123456',
      hasScreenshot: true,
      createdAt: '2026-06-14T10:00:00.000Z',
    },
    {
      id: 'req-2',
      businessId: 'biz-2',
      businessName: 'Beta Retail Solutions',
      businessGstin: '29ABCDE1234F1Z5',
      businessEmail: 'accounts@betaretail.com',
      userId: 'user-2',
      userName: 'Bhavna Patel',
      planName: 'essentials',
      billingCycle: 'yearly',
      amountPaise: 349900,
      paymentMethod: 'bank_transfer',
      paymentReference: 'NEFT-REF-789012',
      hasScreenshot: false,
      createdAt: '2026-06-15T04:30:00.000Z',
    },
  ];

  const businessesFixture = [
    {
      id: 'biz-1',
      legalName: 'Alpha Logistics Pvt Ltd',
      tradeName: 'Alpha Logistics',
      gstin: '27AABCU9603R1ZM',
      stateCode: '27',
      email: 'contact@alphalogistics.in',
      phone: '9876543210',
      subscriptionPlan: 'essentials',
      subscriptionStatus: 'active',
      subscriptionEndsAt: '2027-06-14T23:59:59.000Z',
      activeUtrNo: 'UTR-ALPHA-001',
      createdAt: '2026-01-01T00:00:00.000Z',
      invoiceCount: 42,
      userCount: 3,
    },
    {
      id: 'biz-2',
      legalName: 'Beta Retail Solutions',
      tradeName: 'Beta Mart',
      gstin: '29ABCDE1234F1Z5',
      stateCode: '29',
      email: 'accounts@betaretail.com',
      phone: '9876543211',
      subscriptionPlan: 'essentials',
      subscriptionStatus: 'active',
      subscriptionEndsAt: '2026-07-15T23:59:59.000Z',
      activeUtrNo: 'UTR-BETA-002',
      createdAt: '2026-01-15T00:00:00.000Z',
      invoiceCount: 88,
      userCount: 2,
    },
    {
      id: 'biz-3',
      legalName: 'Gamma Tech Solutions LLP',
      tradeName: 'Gamma Systems',
      gstin: '27AAACG0000A1Z5',
      stateCode: '27',
      email: 'info@gammatech.com',
      phone: '9876543212',
      subscriptionPlan: 'trial',
      subscriptionStatus: 'trial',
      subscriptionEndsAt: null,
      activeUtrNo: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      invoiceCount: 5,
      userCount: 1,
    },
    {
      id: 'biz-4',
      legalName: 'Delta Traders & Co',
      tradeName: null,
      gstin: '33AABCD1234E1Z1',
      stateCode: '33',
      email: 'delta@traders.co.in',
      phone: '9876543213',
      subscriptionPlan: 'essentials',
      subscriptionStatus: 'expired',
      subscriptionEndsAt: '2026-05-31T23:59:59.000Z',
      activeUtrNo: 'UTR-DELTA-004',
      createdAt: '2025-11-01T00:00:00.000Z',
      invoiceCount: 120,
      userCount: 4,
    },
    {
      id: 'biz-5',
      legalName: 'Epsilon Healthcare Products',
      tradeName: 'Epsilon Pharma',
      gstin: '24AABCE5678F1Z9',
      stateCode: '24',
      email: 'ops@epsilonhealth.com',
      phone: '9876543214',
      subscriptionPlan: 'free',
      subscriptionStatus: 'free',
      subscriptionEndsAt: null,
      activeUtrNo: null,
      createdAt: '2026-02-10T00:00:00.000Z',
      invoiceCount: 18,
      userCount: 1,
    },
    {
      id: 'biz-6',
      legalName: 'Zeta Manufacturing Corp',
      tradeName: 'Zeta Metals',
      gstin: '07AABCZ9999K1Z0',
      stateCode: '07',
      email: 'billing@zetamfg.com',
      phone: '9876543215',
      subscriptionPlan: 'professional',
      subscriptionStatus: 'active',
      subscriptionEndsAt: '2027-01-31T23:59:59.000Z',
      activeUtrNo: 'UTR-ZETA-006',
      createdAt: '2025-08-01T00:00:00.000Z',
      invoiceCount: 230,
      userCount: 8,
    },
    {
      id: 'biz-7',
      legalName: 'Eta Consulting Services',
      tradeName: null,
      gstin: '36AABCE1111H1Z2',
      stateCode: '36',
      email: 'contact@etaconsult.in',
      phone: '9876543216',
      subscriptionPlan: 'trial',
      subscriptionStatus: 'trial',
      subscriptionEndsAt: null,
      activeUtrNo: null,
      createdAt: '2026-06-10T00:00:00.000Z',
      invoiceCount: 2,
      userCount: 1,
    },
    {
      id: 'biz-8',
      legalName: 'Theta Creative Studios',
      tradeName: 'Theta Studios',
      gstin: '19AABCT2222J1Z8',
      stateCode: '19',
      email: 'finance@thetastudios.com',
      phone: '9876543217',
      subscriptionPlan: 'essentials',
      subscriptionStatus: 'suspended',
      subscriptionEndsAt: '2026-08-15T23:59:59.000Z',
      activeUtrNo: 'UTR-THETA-008',
      createdAt: '2025-10-15T00:00:00.000Z',
      invoiceCount: 45,
      userCount: 2,
    },
    {
      id: 'biz-9',
      legalName: 'Iota Digital Ventures',
      tradeName: 'Iota Labs',
      gstin: '29AABCI3333L1Z4',
      stateCode: '29',
      email: 'admin@iotalabs.io',
      phone: '9876543218',
      subscriptionPlan: 'free',
      subscriptionStatus: 'free',
      subscriptionEndsAt: null,
      activeUtrNo: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      invoiceCount: 12,
      userCount: 2,
    },
  ];

  const usersFixture = [
    {
      id: 'user-1',
      displayName: 'Aarav Sharma',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      businessId: 'biz-1',
      businessName: 'Alpha Logistics Pvt Ltd',
    },
    {
      id: 'user-2',
      displayName: 'Bhavna Patel',
      role: 'owner',
      createdAt: '2026-01-15T00:00:00.000Z',
      businessId: 'biz-2',
      businessName: 'Beta Retail Solutions',
    },
    {
      id: 'user-3',
      displayName: 'Chirag Verma',
      role: 'staff',
      createdAt: '2026-02-01T00:00:00.000Z',
      businessId: 'biz-1',
      businessName: 'Alpha Logistics Pvt Ltd',
    },
    {
      id: 'user-4',
      displayName: 'Deepa Nair',
      role: 'owner',
      createdAt: '2026-02-10T00:00:00.000Z',
      businessId: 'biz-5',
      businessName: 'Epsilon Healthcare Products',
    },
    {
      id: 'user-5',
      displayName: 'Eshan Gupta',
      role: 'owner',
      createdAt: '2025-11-01T00:00:00.000Z',
      businessId: 'biz-4',
      businessName: 'Delta Traders & Co',
    },
    {
      id: 'user-6',
      displayName: 'Fatima Khan',
      role: 'owner',
      createdAt: '2026-06-01T00:00:00.000Z',
      businessId: 'biz-3',
      businessName: 'Gamma Tech Solutions LLP',
    },
    {
      id: 'user-7',
      displayName: 'Girish Reddy',
      role: 'owner',
      createdAt: '2025-08-01T00:00:00.000Z',
      businessId: 'biz-6',
      businessName: 'Zeta Manufacturing Corp',
    },
    {
      id: 'user-8',
      displayName: 'Harini Iyer',
      role: 'staff',
      createdAt: '2026-03-15T00:00:00.000Z',
      businessId: 'biz-6',
      businessName: 'Zeta Manufacturing Corp',
    },
    {
      id: 'user-9',
      displayName: 'Irfan Pathan',
      role: 'owner',
      createdAt: '2026-03-01T00:00:00.000Z',
      businessId: 'biz-9',
      businessName: 'Iota Digital Ventures',
    },
  ];

  const statsFixture = {
    totalBusinesses: 9,
    activeSubscriptions: 5,
    totalRevenuePaise: 4500000,
    pendingRequestsCount: 2,
    platformInvoiceCount: 142,
    planDistribution: {
      essentials: 4,
      free: 2,
      trial: 2,
      professional: 1,
    },
    monthlyRevenue: [
      { month: 'Jan 2026', revenuePaise: 1000000, claimCount: 2 },
      { month: 'Feb 2026', revenuePaise: 1500000, claimCount: 3 },
      { month: 'Mar 2026', revenuePaise: 2000000, claimCount: 4 },
    ],
  };

  // -------------------------------------------------------------
  // AdminConsole Snapshots (a - g)
  // -------------------------------------------------------------
  it('AdminConsole (a) overview', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'overview';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it("AdminConsole (b) overview with payeeConfigIssue = 'UPI ID missing' and upiConfig null", () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'overview';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: null,
      payeeConfigIssue: 'UPI ID missing',
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AdminConsole (c) pending', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'pending';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AdminConsole (d) pending with 0 claims', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'pending';
    const el = React.createElement(AdminConsole, {
      stats: { ...statsFixture, pendingRequestsCount: 0 },
      pendingRequests: [],
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AdminConsole (e) businesses', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'businesses';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AdminConsole (f) users', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'users';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AdminConsole (g) settings', () => {
    (globalThis as { __ADMIN_TAB__?: string }).__ADMIN_TAB__ = 'settings';
    const el = React.createElement(AdminConsole, {
      stats: statsFixture,
      pendingRequests: pendingRequestsFixture,
      businesses: businessesFixture,
      users: usersFixture,
      upiConfig: upiConfigFixture,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  // -------------------------------------------------------------
  // BillingTab Snapshots (h - m)
  // -------------------------------------------------------------
  const nowMs = Date.parse('2026-06-15T06:30:00Z');

  function makeBusinessFixture(overrides: Partial<typeof businesses.$inferSelect> = {}): typeof businesses.$inferSelect {
    return {
      id: 'biz-1',
      legal_name: 'Acme Enterprises Pvt Ltd',
      trade_name: 'Acme Traders',
      gstin: '27AABCU9603R1ZM',
      state_code: '27',
      pan: 'AABCU9603R',
      registration_type: 'regular' as const,
      address_line1: '123 Business Park',
      address_line2: 'Andheri East',
      city: 'Mumbai',
      pincode: '400069',
      phone: '9876543210',
      email: 'billing@acme.com',
      alternate_phone: null,
      nature_of_business: 'Wholesale & Retail',
      invoice_tagline: null,
      bank_name: 'HDFC Bank',
      bank_account_name: null,
      bank_account_number: '50200012345678',
      bank_ifsc: 'HDFC0000123',
      credit_note_number_prefix: 'CN',
      payment_due_days: 30,
      invoice_terms: 'Payment due in 15 days.',
      invoice_number_format: 'INV/{FY}/{SEQ:3}',
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_display_prefs: {},
      logo_storage_key: null,
      signature_storage_key: null,
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_activated_at: new Date('2026-06-01T00:00:00.000Z'),
      subscription_ends_at: new Date('2027-05-31T23:59:59.000Z'),
      trial_ends_at: null,
      active_utr_no: 'UTR-987654321',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-06-01T00:00:00Z'),
      ...overrides,
    };
  }

  const nineSubscriptionsHistory: SubscriptionHistoryItem[] = [
    {
      id: 'sub-1',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-001',
      hasScreenshot: true,
      status: 'approved',
      rejectReason: null,
      approvedAt: new Date('2026-05-15T12:00:00Z'),
      createdAt: new Date('2026-05-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-2',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_id',
      paymentReference: 'UPI-REF-002',
      hasScreenshot: false,
      status: 'approved',
      rejectReason: null,
      approvedAt: new Date('2026-04-15T12:00:00Z'),
      createdAt: new Date('2026-04-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-3',
      planName: 'essentials',
      billingCycle: 'yearly',
      amountPaise: 349900,
      paymentMethod: 'bank_transfer',
      paymentReference: 'NEFT-REF-003',
      hasScreenshot: true,
      status: 'pending',
      rejectReason: null,
      approvedAt: null,
      createdAt: new Date('2026-06-14T08:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-4',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-004',
      hasScreenshot: false,
      status: 'rejected',
      rejectReason: 'UTR number does not match bank records',
      approvedAt: null,
      createdAt: new Date('2026-03-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-5',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_id',
      paymentReference: 'UPI-REF-005',
      hasScreenshot: false,
      status: 'approved',
      rejectReason: null,
      approvedAt: new Date('2026-02-15T12:00:00Z'),
      createdAt: new Date('2026-02-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-6',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-006',
      hasScreenshot: true,
      status: 'approved',
      rejectReason: null,
      approvedAt: new Date('2026-01-15T12:00:00Z'),
      createdAt: new Date('2026-01-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-7',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'bank_transfer',
      paymentReference: 'NEFT-REF-007',
      hasScreenshot: false,
      status: 'rejected',
      rejectReason: 'Payment not received',
      approvedAt: null,
      createdAt: new Date('2025-12-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-8',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-008',
      hasScreenshot: true,
      status: 'approved',
      rejectReason: null,
      approvedAt: new Date('2025-11-15T12:00:00Z'),
      createdAt: new Date('2025-11-15T10:00:00Z'),
      userName: 'Vikram Mehta',
    },
    {
      id: 'sub-9',
      planName: 'essentials',
      billingCycle: 'monthly',
      amountPaise: 39900,
      paymentMethod: 'upi_qr',
      paymentReference: 'UPI-REF-009',
      hasScreenshot: false,
      status: 'pending',
      rejectReason: null,
      approvedAt: null,
      createdAt: new Date('2026-06-15T05:00:00Z'),
      userName: 'Vikram Mehta',
    },
  ];

  it('BillingTab (h) trial business, no history', () => {
    const biz = makeBusinessFixture({
      subscription_plan: 'trial',
      subscription_status: 'trial',
      subscription_activated_at: new Date('2026-06-01T00:00:00Z'),
      subscription_ends_at: null,
      trial_ends_at: new Date('2026-06-25T00:00:00.000Z'),
      active_utr_no: null,
    });
    const el = React.createElement(BillingTab, {
      business: biz,
      initialSubscriptions: [],
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('BillingTab (i) active essentials with 9 history items (approved/pending/rejected)', () => {
    const biz = makeBusinessFixture({
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_activated_at: new Date('2026-01-01T00:00:00Z'),
      subscription_ends_at: new Date('2027-01-01T00:00:00.000Z'),
      active_utr_no: 'UTR-ACTIVE-12345',
    });
    const el = React.createElement(BillingTab, {
      business: biz,
      initialSubscriptions: nineSubscriptionsHistory,
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('BillingTab (j) expired subscription', () => {
    const biz = makeBusinessFixture({
      subscription_plan: 'essentials',
      subscription_status: 'expired',
      subscription_activated_at: new Date('2025-01-01T00:00:00Z'),
      subscription_ends_at: new Date('2026-06-01T00:00:00.000Z'),
      trial_ends_at: null,
      active_utr_no: 'UTR-EXPIRED-999',
    });
    const el = React.createElement(BillingTab, {
      business: biz,
      initialSubscriptions: [],
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('BillingTab (k) free plan', () => {
    const biz = makeBusinessFixture({
      subscription_plan: 'free',
      subscription_status: 'expired',
      subscription_activated_at: null,
      subscription_ends_at: null,
      trial_ends_at: null,
      active_utr_no: null,
    });
    const el = React.createElement(BillingTab, {
      business: biz,
      initialSubscriptions: [],
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('BillingTab (l) expiring in 3 days', () => {
    const biz = makeBusinessFixture({
      subscription_plan: 'essentials',
      subscription_status: 'active',
      subscription_activated_at: new Date('2025-06-18T00:00:00Z'),
      subscription_ends_at: new Date('2026-06-18T06:30:00.000Z'),
      trial_ends_at: null,
      active_utr_no: 'UTR-SOON-111',
    });
    const el = React.createElement(BillingTab, {
      business: biz,
      initialSubscriptions: [],
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('BillingTab (m) business null', () => {
    const el = React.createElement(BillingTab, {
      business: null,
      initialSubscriptions: [],
      nowMs,
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  // -------------------------------------------------------------
  // AppSidebar Snapshots (n - p)
  // -------------------------------------------------------------
  it("AppSidebar (n) pathname '/dashboard', collapsedPreference false, owner user, trial subscription with endsAt", () => {
    currentPathname = '/dashboard';
    const el = React.createElement(AppSidebar, {
      user: { name: 'Vikram Mehta', role: 'owner', initials: 'VM' },
      collapsedPreference: false,
      isAdminUser: false,
      subscription: { plan: 'trial', status: 'trial', endsAt: '2026-06-30T00:00:00.000Z' },
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AppSidebar (o) collapsedPreference true', () => {
    currentPathname = '/dashboard';
    const el = React.createElement(AppSidebar, {
      user: { name: 'Vikram Mehta', role: 'owner', initials: 'VM' },
      collapsedPreference: true,
      isAdminUser: false,
      subscription: { plan: 'trial', status: 'trial', endsAt: '2026-06-30T00:00:00.000Z' },
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });

  it('AppSidebar (p) collapsedPreference null, isAdminUser true, businessLogoUrl set, active essentials', () => {
    currentPathname = '/dashboard';
    const el = React.createElement(AppSidebar, {
      user: { name: 'Admin User', role: 'admin', initials: 'AU' },
      collapsedPreference: null,
      isAdminUser: true,
      subscription: { plan: 'essentials', status: 'active', endsAt: '2027-06-15T00:00:00.000Z' },
      businessLogoUrl: 'https://storage.billmatrix.in/logos/biz-1.png',
    });
    const html = normalizeMarkup(renderToStaticMarkup(el));
    expect(html).toMatchSnapshot();
  });
});
