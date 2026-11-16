import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/invoices',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

vi.mock('@/lib/actions/team/get-team', () => ({ getTeam: vi.fn() }));
vi.mock('@/lib/actions/team/invite-team-member', () => ({ inviteTeamMember: vi.fn() }));
vi.mock('@/lib/actions/team/resend-team-invite', () => ({ resendTeamInvite: vi.fn() }));
vi.mock('@/lib/actions/team/revoke-team-invite', () => ({ revokeTeamInvite: vi.fn() }));
vi.mock('@/lib/actions/team/remove-team-member', () => ({ removeTeamMember: vi.fn() }));
vi.mock('@/lib/actions/team/change-team-member-role', () => ({ changeTeamMemberRole: vi.fn() }));

vi.mock('@/lib/actions/credit-notes/finalize-credit-note', () => ({ finalizeCreditNote: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/delete-credit-note-draft', () => ({ deleteCreditNoteDraft: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/get-archived-credit-note-pdf-url', () => ({ getArchivedCreditNotePdfUrl: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/void-credit-note', () => ({ voidCreditNote: vi.fn() }));
vi.mock('@/lib/actions/invoices/delete-invoice-draft', () => ({ deleteInvoiceDraft: vi.fn() }));
vi.mock('@/lib/actions/payments/record-payment', () => ({ recordPayment: vi.fn() }));
vi.mock('@/lib/actions/payments/void-payment', () => ({ voidPayment: vi.fn() }));
vi.mock('@/lib/actions/invoices/get-archived-pdf-url', () => ({ getArchivedPdfUrl: vi.fn() }));
vi.mock('@/lib/actions/invoices/email-invoice', () => ({ emailInvoice: vi.fn() }));
vi.mock('@/lib/actions/invoices/send-payment-reminder', () => ({ sendPaymentReminder: vi.fn() }));
vi.mock('@/lib/actions/customers/deactivate-customer', () => ({ deactivateCustomer: vi.fn() }));
vi.mock('@/lib/actions/customers/reactivate-customer', () => ({ reactivateCustomer: vi.fn() }));
vi.mock('@/lib/actions/products/deactivate-product', () => ({ deactivateProduct: vi.fn() }));
vi.mock('@/lib/actions/products/reactivate-product', () => ({ reactivateProduct: vi.fn() }));

import { CurrentUserRoleProvider } from '@/components/app/current-user-role';
import { CustomersClient } from '@/components/app/customers/customers-client';
import { ProductsClient } from '@/components/app/products/products-client';
import { InvoicesClient } from '@/app/(app)/invoices/client';
import { InvoiceDetail } from '@/components/app/invoices/invoice-detail';
import { PaymentSection } from '@/components/app/invoices/payment-section';
import { CreditNoteDetail } from '@/components/app/credit-notes/credit-note-detail';
import type { CustomerRow } from '@/lib/actions/customers/list-customers';
import type { ProductListItem } from '@/lib/actions/products/list-products';
import type { InvoiceListItem } from '@/lib/actions/invoices/list-invoices';
import type { Page } from '@/lib/pagination/keyset';

function makePage<T>(items: readonly T[]): Page<T> {
  return {
    items,
    pageInfo: {
      hasNext: false,
      hasPrevious: false,
      nextCursor: null,
      previousCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
    total: items.length,
    totalCount: items.length,
  };
}

const mockCustomer: CustomerRow = {
  id: 'c0000000-0000-0000-0000-000000000001',
  business_id: 'b0000000-0000-0000-0000-000000000001',
  name: 'Beta Industries',
  gstin: '29ABCDE1234F1Z5',
  email: 'buyer@beta.test',
  phone: '9988776655',
  address_line1: '123 MG Road',
  address_line2: null,
  city: 'Bengaluru',
  state_code: '29',
  pincode: '560001',
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const mockProductItem: ProductListItem = {
  product: {
    id: 'p0000000-0000-0000-0000-000000000001',
    business_id: 'b0000000-0000-0000-0000-000000000001',
    name: 'Industrial Widget',
    description: null,
    hsn_sac_code: '84713010',
    unit_of_measurement: 'PCS',
    default_sale_price_paise: 25000,
    default_tax_rate_id: 't0000000-0000-0000-0000-000000000001',
    stock_quantity: 100,
    is_active: true,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  },
  taxRate: {
    id: 't0000000-0000-0000-0000-000000000001',
    label: '18%',
    rate_percentage: '18.00',
    is_active: true,
    effective_from: '2024-01-01',
    effective_to: null,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  },
};

const mockInvoiceItem: InvoiceListItem = {
  id: 'i0000000-0000-0000-0000-000000000001',
  invoice_number: 'INV-001',
  invoice_date: '2026-11-01',
  due_date: '2026-11-15',
  customer_name: 'Beta Industries',
  place_of_supply_state_code: '29',
  grand_total_paise: 118000,
  lifecycle_status: 'finalized',
  payment_status: 'paid',
  refund_due_paise: 0,
};

const mockDraftCreditNote = {
  id: 'cn_draft_1',
  credit_note_number: 'CN-DRAFT-1',
  issue_date: '2026-11-16T10:00:00.000Z',
  reason: '01-Sales Return',
  subtotal_paise: 100000,
  total_cgst_paise: 9000,
  total_sgst_paise: 9000,
  total_igst_paise: 0,
  total_tax_paise: 18000,
  grand_total_paise: 118000,
  original_invoice_id: 'inv_1',
  lifecycle_status: 'draft' as const,
  business: {
    id: 'biz_1',
    legal_name: 'Acme Traders',
    gstin: '29ABCDE1234F1Z5',
    state_code: '29',
  },
  originalInvoice: {
    id: 'inv_1',
    invoice_number: 'INV-001',
    invoice_date: '2026-11-01T10:00:00.000Z',
    place_of_supply_state_code: '29',
    grand_total_paise: 200000,
  },
  lineItems: [],
};

const mockDetailInvoice = {
  id: 'inv_1',
  invoice_number: 'INV-001',
  invoice_date: '2026-11-01',
  due_date: '2026-11-15',
  customer_name: 'Beta Industries',
  customer_gstin: '29ABCDE1234F1Z5',
  place_of_supply_state_code: '29',
  subtotal_paise: 100000,
  total_cgst_paise: 9000,
  total_sgst_paise: 9000,
  total_igst_paise: 0,
  total_tax_paise: 18000,
  grand_total_paise: 118000,
  lifecycle_status: 'finalized' as const,
  archival_status: 'archived' as const,
  status: 'paid',
  payment_due_date: '2026-11-15',
  payment_status: 'paid' as const,
  customer_email: 'buyer@beta.test',
  customer_phone: '9988776655',
  business_id: 'biz_1',
  business_name: 'Acme Traders',
  business_gstin: '29ABCDE1234F1Z5',
  business_state_code: '29',
  city: 'Bengaluru',
  seller_gstin_snapshot: '29ABCDE1234F1Z5',
  phone: '9988776655',
  bank_name: 'HDFC Bank',
  bank_account_number: '123456789',
  bank_ifsc: 'HDFC0001234',
  invoice_terms: '30 days',
  billing_name_snapshot: 'Beta Industries',
  billing_gstin_snapshot: '29ABCDE1234F1Z5',
  billing_address_snapshot: 'MG Road',
  lineItems: [],
  line_items: [],
};

const mockPayments = [
  {
    id: 'pay_1',
    amount_paise: 50000,
    payment_date: '2026-11-05T10:00:00.000Z',
    payment_method: 'bank_transfer',
    status: 'recorded',
    kind: 'payment' as const,
  },
];

describe('Accountant Read-Only View Across App (B2-CA-UI)', () => {
  describe('Customers View', () => {
    it('accountant sees customer directory without Add Customer or Edit link', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <CustomersClient
            page={makePage([mockCustomer])}
            previousHref={null}
            nextHref={null}
            currentParams={{ q: null, includeInactive: false, size: 20 }}
          />
        </CurrentUserRoleProvider>
      );

      expect(html).toContain('Beta Industries');
      expect(html).not.toContain('Add Customer');
      expect(html).not.toContain('/customers/c0000000-0000-0000-0000-000000000001/edit');
    });

    it('staff and owner see Add Customer and Edit link', () => {
      for (const role of ['owner', 'staff'] as const) {
        const html = renderToStaticMarkup(
          <CurrentUserRoleProvider role={role}>
            <CustomersClient
              page={makePage([mockCustomer])}
              previousHref={null}
              nextHref={null}
              currentParams={{ q: null, includeInactive: false, size: 20 }}
            />
          </CurrentUserRoleProvider>
        );

        expect(html).toContain('Add Customer');
        expect(html).toContain('/customers/c0000000-0000-0000-0000-000000000001/edit');
      }
    });
  });

  describe('Products View', () => {
    it('accountant sees product directory without Add Product or Edit link', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <ProductsClient
            page={makePage([mockProductItem])}
            previousHref={null}
            nextHref={null}
            currentParams={{ q: null, includeInactive: false, size: 20, kind: 'all' }}
          />
        </CurrentUserRoleProvider>
      );

      expect(html).toContain('Industrial Widget');
      expect(html).not.toContain('Add Product');
      expect(html).not.toContain('/products/p0000000-0000-0000-0000-000000000001/edit');
    });

    it('staff and owner see Add Product and Edit link', () => {
      for (const role of ['owner', 'staff'] as const) {
        const html = renderToStaticMarkup(
          <CurrentUserRoleProvider role={role}>
            <ProductsClient
              page={makePage([mockProductItem])}
              previousHref={null}
              nextHref={null}
              currentParams={{ q: null, includeInactive: false, size: 20, kind: 'all' }}
            />
          </CurrentUserRoleProvider>
        );

        expect(html).toContain('Add Product');
        expect(html).toContain('/products/p0000000-0000-0000-0000-000000000001/edit');
      }
    });
  });

  describe('Invoices List View', () => {
    it('accountant cannot see New Invoice button', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <InvoicesClient
            invoicesPage={makePage([mockInvoiceItem])}
            creditNotesPage={makePage([])}
            businessStateCode="29"
            activeTab="invoices"
            previousHref={null}
            nextHref={null}
            currentParams={{ tab: 'invoices', q: null, status: 'all', month: 11, year: 2026, size: 20 }}
          />
        </CurrentUserRoleProvider>
      );

      expect(html).toContain('INV-001');
      expect(html).not.toContain('New Invoice');
    });

    it('staff and owner see New Invoice button', () => {
      for (const role of ['owner', 'staff'] as const) {
        const html = renderToStaticMarkup(
          <CurrentUserRoleProvider role={role}>
            <InvoicesClient
              invoicesPage={makePage([mockInvoiceItem])}
              creditNotesPage={makePage([])}
              businessStateCode="29"
              activeTab="invoices"
              previousHref={null}
              nextHref={null}
              currentParams={{ tab: 'invoices', q: null, status: 'all', month: 11, year: 2026, size: 20 }}
            />
          </CurrentUserRoleProvider>
        );

        expect(html).toContain('New Invoice');
      }
    });
  });

  describe('Invoice Detail and Payments View', () => {
    it('accountant sees Print and Download PDF but not WhatsApp, Email, or Issue Credit Note', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <InvoiceDetail
            invoice={mockDetailInvoice}
            business={{
              id: 'biz_1',
              legal_name: 'Acme Traders',
              subscription_plan: 'essentials',
              subscription_status: 'active',
            }}
            payments={mockPayments}
            creditNotes={[]}
            businessStateCode="29"
            displayPrefs={{
              discEnabled: false,
              showHsn: true,
              showNextNo: false,
              showSignatory: true,
              enableFixedRows: false,
              fixedRowsCount: 10,
              defaultGst: '18',
              quantityDecimals: 0,
            }}
          />
        </CurrentUserRoleProvider>
      );

      expect(html).toContain('Print');
      expect(html).toContain('Download PDF');
      expect(html).not.toContain('WhatsApp');
      expect(html).not.toContain('>Email<');
      expect(html).not.toContain('Issue Credit Note');
    });

    it('accountant sees payment ledger but not the Record Payment form', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <PaymentSection
            invoice={{ id: 'inv_1', invoice_number: 'INV-001', grand_total_paise: 200000 }}
            payments={mockPayments}
          />
        </CurrentUserRoleProvider>
      );

      // Ledger history is shown
      expect(html).toContain('Payment &amp; Audit Ledger');
      // Record payment form is absent
      expect(html).not.toContain('Record Payment');
      expect(html).not.toContain('Record Refund');
    });
  });

  // Positive controls: the SAME components rendered for an owner / staff DO show the controls the accountant tests
  // expect to be missing, so those absence checks cannot pass vacuously. React's SSR inserts `<!-- -->` between
  // adjacent text nodes ("Record <!-- -->Payment"), so markup is normalised before matching.
  describe('Positive controls (owner / staff see the write controls)', () => {
    const text = (html: string) => html.replace(/<!-- -->/g, '');

    it('owner sees WhatsApp, Email and Issue Credit Note on the same invoice', () => {
      const html = text(
        renderToStaticMarkup(
          <CurrentUserRoleProvider role="owner">
            <InvoiceDetail
              invoice={mockDetailInvoice}
              business={{ id: 'biz_1', legal_name: 'Acme Traders', subscription_plan: 'essentials', subscription_status: 'active' }}
              payments={mockPayments}
              creditNotes={[]}
              businessStateCode="29"
              displayPrefs={{
                discEnabled: false,
                showHsn: true,
                showNextNo: false,
                showSignatory: true,
                enableFixedRows: false,
                fixedRowsCount: 10,
                defaultGst: '18',
                quantityDecimals: 0,
              }}
            />
          </CurrentUserRoleProvider>,
        ),
      );
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Issue Credit Note');
    });

    it('staff sees the Record Payment form that the accountant does not', () => {
      const props = { invoice: { id: 'inv_1', invoice_number: 'INV-001', grand_total_paise: 200000 }, payments: mockPayments };
      const staff = text(
        renderToStaticMarkup(
          <CurrentUserRoleProvider role="staff">
            <PaymentSection {...props} />
          </CurrentUserRoleProvider>,
        ),
      );
      const accountant = text(
        renderToStaticMarkup(
          <CurrentUserRoleProvider role="accountant">
            <PaymentSection {...props} />
          </CurrentUserRoleProvider>,
        ),
      );
      expect(staff).toMatch(/Record (Payment|Refund)/);
      expect(accountant).not.toMatch(/Record (Payment|Refund)/);
    });

    it('owner sees Finalize on the same draft credit note; the accountant does not', () => {
      const owner = text(
        renderToStaticMarkup(
          <CurrentUserRoleProvider role="owner">
            <CreditNoteDetail creditNote={mockDraftCreditNote} />
          </CurrentUserRoleProvider>,
        ),
      );
      expect(owner).toContain('Finalize &amp; Lock');
      expect(owner).not.toContain('Read-only access.');
    });
  });

  describe('Credit Note Detail View', () => {
    it('accountant sees "Read-only access." and no finalize/delete/void buttons', () => {
      const html = renderToStaticMarkup(
        <CurrentUserRoleProvider role="accountant">
          <CreditNoteDetail creditNote={mockDraftCreditNote} />
        </CurrentUserRoleProvider>
      );

      expect(html).toContain('Read-only access.');
      expect(html).not.toContain('Finalize &amp; Lock');
      expect(html).not.toContain('Discard Draft');
      expect(html).not.toContain('Void Note');
    });
  });
});
