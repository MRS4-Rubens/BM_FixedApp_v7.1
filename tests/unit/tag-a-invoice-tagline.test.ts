import { describe, expect, it } from 'vitest';
import {
  normaliseInvoiceTagline,
  INVOICE_TAGLINE_MAX,
  INVOICE_TAGLINE_EXAMPLES,
} from '@/lib/business/invoice-tagline';
import { businessProfileSchema } from '@/lib/validations/business';
import {
  captureSellerSnapshot,
  resolveSellerDetails,
  toInvoicePrintFields,
  type LiveBusinessSeller,
  type SellerSnapshotRow,
} from '@/lib/invoices/seller-snapshot';
import { buildPreviewInvoiceData } from '@/components/app/invoices/invoice-form/form-calculations';
import type { CurrentBusiness } from '@/lib/auth/current-business';

const validBaseProfile = {
  legal_name: 'Acme Traders Pvt Ltd',
  trade_name: 'Acme Traders',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  registration_type: 'regular' as const,
  address_line1: '123 Market Road',
  address_line2: '',
  city: 'Bengaluru',
  state_code: '29',
  pincode: '560001',
  phone: '9876543210',
  alternate_phone: '',
  email: 'contact@acme.com',
  nature_of_business: 'Wholesale & Retail',
  bank_account_name: 'Acme Traders',
  bank_account_number: '123456789012',
  bank_ifsc: 'SBIN0001234',
  bank_name: 'State Bank of India',
};

const mockLiveBusiness: LiveBusinessSeller = {
  id: '00000000-0000-0000-0000-000000000001',
  legal_name: 'Acme Traders Pvt Ltd',
  trade_name: 'Acme Traders',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  address_line1: '123 Market Road',
  address_line2: null,
  city: 'Bengaluru',
  state_code: '29',
  pincode: '560001',
  phone: '9876543210',
  alternate_phone: null,
  email: 'contact@acme.com',
  nature_of_business: 'Wholesale & Retail',
  invoice_tagline: 'DEALERS IN MOBILE PHONES, ACCESSORIES & REPAIRS',
  logo_storage_key: null,
  signature_storage_key: null,
  bank_account_name: 'Acme Traders',
  bank_account_number: '123456789012',
  bank_ifsc: 'SBIN0001234',
  bank_name: 'State Bank of India',
  invoice_terms: 'Standard terms',
};

describe('SPEC: TAG-A Invoice Tagline Unit Tests', () => {
  describe('normaliseInvoiceTagline', () => {
    it('returns null for null, undefined, empty string, and whitespace-only strings', () => {
      expect(normaliseInvoiceTagline(null)).toBeNull();
      expect(normaliseInvoiceTagline(undefined)).toBeNull();
      expect(normaliseInvoiceTagline('')).toBeNull();
      expect(normaliseInvoiceTagline('   ')).toBeNull();
      expect(normaliseInvoiceTagline('\t\r\n  ')).toBeNull();
    });

    it('collapses runs of whitespace, trims, and converts to uppercase', () => {
      expect(normaliseInvoiceTagline('  wholesalers   &  retailers ')).toBe('WHOLESALERS & RETAILERS');
    });

    it('replaces newlines and tabs with a single space', () => {
      expect(normaliseInvoiceTagline("line 1\r\nline 2\tline 3")).toBe('LINE 1 LINE 2 LINE 3');
    });
  });

  describe('businessProfileSchema invoice_tagline validation', () => {
    it('passes for an 80-character valid tagline', () => {
      // Exactly 80 characters
      const exact80 = 'A'.repeat(80);
      const res = businessProfileSchema.safeParse({
        ...validBaseProfile,
        invoice_tagline: exact80,
      });
      expect(res.success).toBe(true);
    });

    it('fails for an 81-character tagline with the 80 characters error message', () => {
      const over80 = 'A'.repeat(81);
      const res = businessProfileSchema.safeParse({
        ...validBaseProfile,
        invoice_tagline: over80,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const msg = res.error.issues.find((i) => i.path.includes('invoice_tagline'))?.message;
        expect(msg).toBe(`Keep the tagline to ${INVOICE_TAGLINE_MAX} characters or fewer`);
      }
    });

    it('fails for disallowed characters like <script>', () => {
      const res = businessProfileSchema.safeParse({
        ...validBaseProfile,
        invoice_tagline: '<script>alert(1)</script>',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const msg = res.error.issues.find((i) => i.path.includes('invoice_tagline'))?.message;
        expect(msg).toBe("Use letters, numbers, spaces and & @ , . ; : - / ( ) ' + | only");
      }
    });

    it('fails for emoji characters', () => {
      const res = businessProfileSchema.safeParse({
        ...validBaseProfile,
        invoice_tagline: 'BEST SHOP IN TOWN 🔥',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const msg = res.error.issues.find((i) => i.path.includes('invoice_tagline'))?.message;
        expect(msg).toBe("Use letters, numbers, spaces and & @ , . ; : - / ( ) ' + | only");
      }
    });

    it('passes for empty string and saves as null via normaliseInvoiceTagline', () => {
      const res = businessProfileSchema.safeParse({
        ...validBaseProfile,
        invoice_tagline: '',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(normaliseInvoiceTagline(res.data.invoice_tagline)).toBeNull();
      }
    });
  });

  describe('INVOICE_TAGLINE_EXAMPLES', () => {
    it('every example is <= 80 characters and passes validation', () => {
      for (const example of INVOICE_TAGLINE_EXAMPLES) {
        expect(example.length).toBeLessThanOrEqual(INVOICE_TAGLINE_MAX);
        const res = businessProfileSchema.safeParse({
          ...validBaseProfile,
          invoice_tagline: example,
        });
        expect(res.success).toBe(true);
      }
    });
  });

  describe('captureSellerSnapshot', () => {
    it('copies invoice_tagline from live business to seller_tagline_snapshot', () => {
      const snapshot = captureSellerSnapshot(mockLiveBusiness);
      expect(snapshot.seller_tagline_snapshot).toBe('DEALERS IN MOBILE PHONES, ACCESSORIES & REPAIRS');
    });

    it('copies null invoice_tagline as null seller_tagline_snapshot', () => {
      const snapshot = captureSellerSnapshot({
        ...mockLiveBusiness,
        invoice_tagline: null,
      });
      expect(snapshot.seller_tagline_snapshot).toBeNull();
    });
  });

  describe('resolveSellerDetails', () => {
    it('returns tagline from snapshot (NOT live) for finalized documents', () => {
      const finalizedDoc: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme Traders Pvt Ltd',
        seller_trade_name_snapshot: 'Acme Traders',
        seller_address_snapshot: {
          line1: '123 Market Road',
          line2: null,
          city: 'Bengaluru',
          pincode: '560001',
        },
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_tagline_snapshot: 'FROZEN TAGLINE FROM SNAPSHOT',
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      const liveWithDifferentTagline: LiveBusinessSeller = {
        ...mockLiveBusiness,
        invoice_tagline: 'LIVE CHANGED TAGLINE',
      };

      const details = resolveSellerDetails(finalizedDoc, liveWithDifferentTagline);
      expect(details.source).toBe('snapshot');
      expect(details.tagline).toBe('FROZEN TAGLINE FROM SNAPSHOT');
    });

    it('returns tagline null for legacy finalized rows without the field', () => {
      const legacyFinalizedDoc: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme Traders Pvt Ltd',
        seller_trade_name_snapshot: 'Acme Traders',
        seller_address_snapshot: {
          line1: '123 Market Road',
          line2: null,
          city: 'Bengaluru',
          pincode: '560001',
        },
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_tagline_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      const details = resolveSellerDetails(legacyFinalizedDoc, null);
      expect(details.source).toBe('snapshot');
      expect(details.tagline).toBeNull();
    });

    it('returns tagline from live business for draft documents', () => {
      const draftDoc: SellerSnapshotRow = {
        lifecycle_status: 'draft',
        seller_gstin_snapshot: null,
        seller_name_snapshot: null,
        seller_trade_name_snapshot: null,
        seller_address_snapshot: null,
        seller_state_code_snapshot: null,
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_tagline_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      const details = resolveSellerDetails(draftDoc, mockLiveBusiness);
      expect(details.source).toBe('live');
      expect(details.tagline).toBe('DEALERS IN MOBILE PHONES, ACCESSORIES & REPAIRS');
    });
  });

  describe('toInvoicePrintFields', () => {
    it('exposes invoice_tagline', () => {
      const details = resolveSellerDetails(
        {
          lifecycle_status: 'finalized',
          seller_gstin_snapshot: '29ABCDE1234F1Z5',
          seller_name_snapshot: 'Acme Traders Pvt Ltd',
          seller_trade_name_snapshot: null,
          seller_address_snapshot: { line1: 'L1', line2: null, city: 'C', pincode: 'P' },
          seller_state_code_snapshot: '29',
          seller_phone_snapshot: null,
          seller_alternate_phone_snapshot: null,
          seller_email_snapshot: null,
          seller_nature_of_business_snapshot: null,
          seller_tagline_snapshot: 'WHOLESALERS & RETAILERS OF TEXT BOOKS',
          seller_pan_snapshot: null,
          seller_bank_snapshot: null,
          terms_snapshot: null,
          logo_storage_key_snapshot: null,
        },
        null
      );

      const fields = toInvoicePrintFields(details);
      expect(fields.invoice_tagline).toBe('WHOLESALERS & RETAILERS OF TEXT BOOKS');
    });
  });

  describe('buildPreviewInvoiceData', () => {
    it('passes invoice_tagline from the business', () => {
      const dummyBusiness = {
        id: 'biz_01',
        legal_name: 'Acme Traders',
        trade_name: 'Acme',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        state_code: '29',
        address_line1: '123 Market Rd',
        address_line2: null,
        city: 'Bengaluru',
        pincode: '560001',
        phone: '9876543210',
        alternate_phone: null,
        email: null,
        nature_of_business: 'Retail',
        invoice_tagline: 'DEALERS IN MOBILE PHONES & REPAIRS',
        bank_name: null,
        bank_account_number: null,
        bank_ifsc: null,
        invoice_terms: null,
        logo_storage_key: null,
        subscription_plan: 'free',
        subscription_status: 'active',
        trial_ends_at: null,
      } as unknown as CurrentBusiness;

      const result = buildPreviewInvoiceData({
        business: dummyBusiness,
        watchLineItems: [],
        watchPlaceOfSupplyState: '29',
        watchBillingName: 'Customer',
        watchBillingGstin: '',
        watchInvoiceDate: '2026-04-01',
        watchTemplate: 'template_1',
        gstRateTypeVal: 'exclusive',
        taxRates: [],
        selectedCustomer: null,
        invoiceNumberFormatPreview: 'INV-001',
      });

      expect(result.invoice_tagline).toBe('DEALERS IN MOBILE PHONES & REPAIRS');
    });
  });
});

