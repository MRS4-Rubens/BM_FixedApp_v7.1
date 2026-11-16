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
  usePathname: () => '/settings',
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
vi.mock('@/lib/actions/notifications/notification-settings', () => ({ getNotificationSettings: vi.fn(), saveNotificationPreferences: vi.fn() }));
vi.mock('@/lib/actions/notifications/save-gst-filing-frequency', () => ({ saveGstFilingFrequency: vi.fn() }));

vi.mock('@/lib/actions/business/save-business-profile', () => ({ saveBusinessProfile: vi.fn() }));
vi.mock('@/lib/actions/business/upload-logo', () => ({ uploadBusinessLogo: vi.fn() }));
vi.mock('@/lib/actions/business/remove-logo', () => ({ removeBusinessLogo: vi.fn() }));
vi.mock('@/lib/actions/business/upload-signature', () => ({ uploadBusinessSignature: vi.fn() }));
vi.mock('@/lib/actions/business/remove-signature', () => ({ removeBusinessSignature: vi.fn() }));
vi.mock('@/lib/actions/invoices/save-invoice-settings', () => ({ saveInvoiceSettings: vi.fn() }));
vi.mock('@/lib/actions/invoices/import-legacy-display-prefs', () => ({ importLegacyDisplayPrefs: vi.fn() }));
vi.mock('@/lib/actions/feedback/send-feedback', () => ({ sendFeedbackAction: vi.fn() }));
vi.mock('@/lib/actions/account/request-account-closure', () => ({ requestAccountClosureAction: vi.fn() }));
vi.mock('@/lib/actions/account/export-account-data', () => ({ exportAccountData: vi.fn() }));
vi.mock('@/lib/actions/subscriptions/get-business-subscriptions', () => ({ getBusinessSubscriptions: vi.fn() }));
vi.mock('@/lib/actions/subscriptions/process-request', () => ({ processSubscriptionClaim: vi.fn() }));
vi.mock('@/lib/actions/subscriptions/update-business-subscription', () => ({ updateBusinessSubscription: vi.fn() }));
vi.mock('@/lib/actions/subscriptions/update-platform-payee', () => ({ updatePlatformPayeeAction: vi.fn() }));
vi.mock('@/lib/actions/subscriptions/get-claim-screenshot-url', () => ({ getClaimScreenshotUrl: vi.fn() }));
vi.mock('@/lib/actions/business/admin-update-business-identity', () => ({ adminUpdateBusinessIdentity: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/finalize-credit-note', () => ({ finalizeCreditNote: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/delete-credit-note-draft', () => ({ deleteCreditNoteDraft: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/get-archived-credit-note-pdf-url', () => ({ getArchivedCreditNotePdfUrl: vi.fn() }));
vi.mock('@/lib/actions/credit-notes/void-credit-note', () => ({ voidCreditNote: vi.fn() }));
vi.mock('@/lib/actions/payments/record-payment', () => ({ recordPayment: vi.fn() }));
vi.mock('@/lib/actions/payments/void-payment', () => ({ voidPayment: vi.fn() }));

import { SettingsClient } from '@/components/app/settings/settings-client';
import { CurrentUserRoleProvider } from '@/components/app/current-user-role';
import { CreditNoteDetail } from '@/components/app/credit-notes/credit-note-detail';
import { PaymentSection } from '@/components/app/invoices/payment-section';
import type { businesses } from '@/lib/db/schema';

const mockBusiness = {
  id: 'biz_123',
  legal_name: 'Acme Traders Private Limited',
  trade_name: 'Acme Traders',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  registration_type: 'regular',
  address_line1: '123 MG Road',
  address_line2: 'Suite 400',
  city: 'Bengaluru',
  state_code: '29',
  pincode: '560001',
  phone: '9876543210',
  email: 'owner@acme.test',
  logo_storage_key: null,
  signature_storage_key: null,
  bank_account_name: 'Acme Traders',
  bank_account_number: '123456789012',
  bank_ifsc: 'HDFC0001234',
  bank_name: 'HDFC Bank',
  invoice_terms: 'Payment due in 30 days',
  invoice_number_format: 'INV-{DD}/{MM}/{YY}/{SEQ:3}',
  invoice_display_prefs: {},
  default_invoice_template: 'template_1',
  credit_note_number_prefix: 'CN',
  payment_due_days: 30,
  nature_of_business: 'Wholesale',
  invoice_tagline: 'Reliable Trade',
} as unknown as typeof businesses.$inferSelect;

const mockDraftCreditNote = {
  id: 'cn_draft_1',
  credit_note_number: 'CN-001',
  issue_date: '2026-11-16T10:00:00.000Z',
  reason: '01-Sales Return',
  subtotal_paise: 100000,
  total_cgst_paise: 9000,
  total_sgst_paise: 9000,
  total_igst_paise: 0,
  total_tax_paise: 18000,
  grand_total_paise: 118000,
  original_invoice_id: 'inv_100',
  lifecycle_status: 'draft',
  business: {
    id: 'biz_123',
    legal_name: 'Acme Traders',
    gstin: '29ABCDE1234F1Z5',
    state_code: '29',
  },
  originalInvoice: {
    id: 'inv_100',
    invoice_number: 'INV-100',
    invoice_date: '2026-11-01T10:00:00.000Z',
    place_of_supply_state_code: '29',
    grand_total_paise: 200000,
  },
  lineItems: [],
};

const mockFinalizedCreditNote = {
  ...mockDraftCreditNote,
  id: 'cn_final_1',
  lifecycle_status: 'finalized',
};

const mockInvoice = {
  id: 'inv_100',
  invoice_number: 'INV-100',
  grand_total_paise: 200000,
};

const mockPayments = [
  {
    id: 'pay_1',
    amount_paise: 50000,
    payment_date: '2026-11-05T10:00:00.000Z',
    payment_method: 'bank_transfer',
    status: 'recorded',
  },
];

describe('Staff View Across App (A2-TEAM-UI)', () => {
  describe('SettingsClient', () => {
    it('renders for staff: hides Users & Roles, Billing & Usage, General; disables Business Profile with neutral banner', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'staff' },
          React.createElement(SettingsClient, {
            business: mockBusiness,
            currentFyLabel: '2026-27',
            nowMs: Date.now(),
            userRole: 'staff',
          })
        )
      );

      // Staff hidden tabs are not rendered in the nav
      expect(html).not.toContain('Users &amp; Roles');
      expect(html).not.toContain('Billing &amp; Usage');
      expect(html).not.toContain('>General<');

      // Allowed tabs are present
      expect(html).toContain('Business Profile');
      expect(html).toContain('Invoice Settings');
      expect(html).toContain('User Feedback');
      expect(html).toContain('Notifications');

      // Banner for staff is shown
      expect(html).toContain('Only the business owner can change these details.');

      // Inputs are disabled
      expect(html).toContain('disabled=""');
    });

    it('renders for owner: shows all tabs, and no tab says "Coming soon" (Notifications shipped in feature C)', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'owner' },
          React.createElement(SettingsClient, {
            business: mockBusiness,
            currentFyLabel: '2026-27',
            nowMs: Date.now(),
            userRole: 'owner',
          })
        )
      );

      // All tabs are present
      expect(html).toContain('Business Profile');
      expect(html).toContain('Invoice Settings');
      expect(html).toContain('Users &amp; Roles');
      expect(html).toContain('Billing &amp; Usage');
      expect(html).toContain('User Feedback');
      expect(html).toContain('Notifications');
      expect(html).toContain('>General<');

      // Feature C: Notifications is live, so no settings tab carries a "Coming soon" pill any more
      expect(html).not.toContain('Coming soon');

      // Neutral staff banner is NOT shown for owner
      expect(html).not.toContain('Only the business owner can change these details.');
    });
  });

  describe('Credit Note Finalize & Void Controls', () => {
    it('for staff: Finalize is disabled with owner explanation text, and Void Note is hidden', () => {
      const draftHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'staff' },
          React.createElement(CreditNoteDetail, {
            creditNote: mockDraftCreditNote,
          })
        )
      );

      // Finalize button is disabled
      expect(draftHtml).toContain('disabled=""');
      expect(draftHtml).toContain('Finalize &amp; Lock');
      expect(draftHtml).toContain(
        'Only the business owner can finalize credit notes. Save it as a draft and ask the owner.'
      );

      const finalHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'staff' },
          React.createElement(CreditNoteDetail, {
            creditNote: mockFinalizedCreditNote,
          })
        )
      );

      // Void Note button is hidden for staff
      expect(finalHtml).not.toContain('Void Note');
    });

    it('for owner: Finalize is active without warning, and Void Note is available on finalized notes', () => {
      const draftHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'owner' },
          React.createElement(CreditNoteDetail, {
            creditNote: mockDraftCreditNote,
          })
        )
      );

      // Finalize is enabled and has no staff warning text
      expect(draftHtml).toContain('Finalize &amp; Lock');
      expect(draftHtml).not.toContain(
        'Only the business owner can finalize credit notes.'
      );

      const finalHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'owner' },
          React.createElement(CreditNoteDetail, {
            creditNote: mockFinalizedCreditNote,
          })
        )
      );

      // Void Note button is visible for owner
      expect(finalHtml).toContain('Void Note');
    });
  });

  describe('Payment Void Control', () => {
    it('hides Void button for staff and shows Void button for owner', () => {
      const staffHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'staff' },
          React.createElement(PaymentSection, {
            invoice: mockInvoice,
            payments: mockPayments,
          })
        )
      );

      expect(staffHtml).not.toContain('>Void</button>');

      const ownerHtml = renderToStaticMarkup(
        React.createElement(
          CurrentUserRoleProvider,
          { role: 'owner' },
          React.createElement(PaymentSection, {
            invoice: mockInvoice,
            payments: mockPayments,
          })
        )
      );

      expect(ownerHtml).toContain('Void');
    });
  });
});
