import { describe, expect, it } from 'vitest';
import {
  captureSellerSnapshot,
  resolveSellerDetails,
  SellerSnapshotError,
  toInvoicePrintFields,
  toCreditNotePrintBusiness,
  type LiveBusinessSeller,
  type SellerSnapshotRow,
} from '@/lib/invoices/seller-snapshot';

const mockLiveBusiness: LiveBusinessSeller = {
  id: '00000000-0000-0000-0000-000000000001',
  legal_name: 'Acme Technologies Pvt Ltd',
  trade_name: 'Acme Tech',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  address_line1: '123 Innovation Way',
  address_line2: 'Block B, 4th Floor',
  city: 'Bengaluru',
  state_code: '29',
  pincode: '560001',
  phone: '+91 9876543210',
  alternate_phone: '+91 9876543211',
  email: 'billing@acme.com',
  nature_of_business: 'IT Consulting & Services',
  invoice_tagline: null,
  logo_storage_key: 'businesses/0001/logo-123.png',
  signature_storage_key: null,
  bank_account_name: 'Acme Tech Primary',
  bank_account_number: '123456789012',
  bank_ifsc: 'HDFC0001234',
  bank_name: 'HDFC Bank',
  invoice_terms: 'Payment due within 30 days.',
};

describe('COMP-001: seller-snapshot pure module', () => {
  describe('captureSellerSnapshot', () => {
    it('copies every field from live business to snapshot values', () => {
      const snapshot = captureSellerSnapshot(mockLiveBusiness);

      expect(snapshot.seller_name_snapshot).toBe('Acme Technologies Pvt Ltd');
      expect(snapshot.seller_trade_name_snapshot).toBe('Acme Tech');
      expect(snapshot.seller_state_code_snapshot).toBe('29');
      expect(snapshot.seller_phone_snapshot).toBe('+91 9876543210');
      expect(snapshot.seller_alternate_phone_snapshot).toBe('+91 9876543211');
      expect(snapshot.seller_email_snapshot).toBe('billing@acme.com');
      expect(snapshot.seller_nature_of_business_snapshot).toBe('IT Consulting & Services');
      expect(snapshot.seller_pan_snapshot).toBe('ABCDE1234F');
      expect(snapshot.terms_snapshot).toBe('Payment due within 30 days.');
      expect(snapshot.logo_storage_key_snapshot).toBe('businesses/0001/logo-123.png');
      expect(snapshot.seller_snapshot_source).toBe('captured_at_finalization');

      expect(snapshot.seller_address_snapshot).toEqual({
        line1: '123 Innovation Way',
        line2: 'Block B, 4th Floor',
        city: 'Bengaluru',
        pincode: '560001',
      });

      expect(snapshot.seller_bank_snapshot).toEqual({
        accountName: 'Acme Tech Primary',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
      });
    });

    it('sets seller_bank_snapshot to null when all bank fields are blank or null', () => {
      const noBankBusiness: LiveBusinessSeller = {
        ...mockLiveBusiness,
        bank_account_name: null,
        bank_account_number: '   ',
        bank_ifsc: null,
        bank_name: '',
      };
      const snapshot = captureSellerSnapshot(noBankBusiness);
      expect(snapshot.seller_bank_snapshot).toBeNull();
    });

    it('populates seller_bank_snapshot when any bank field is non-empty', () => {
      const partialBankBusiness: LiveBusinessSeller = {
        ...mockLiveBusiness,
        bank_account_name: null,
        bank_account_number: '987654321098',
        bank_ifsc: null,
        bank_name: null,
      };
      const snapshot = captureSellerSnapshot(partialBankBusiness);
      expect(snapshot.seller_bank_snapshot).toEqual({
        accountName: null,
        accountNumber: '987654321098',
        ifsc: null,
        bankName: null,
      });
    });
  });

  describe('resolveSellerDetails', () => {
    it('strictly prefers snapshot details even when live business details differ', () => {
      const docRow: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Historical Name Pvt Ltd',
        seller_trade_name_snapshot: 'Old Trade',
        seller_address_snapshot: {
          line1: 'Old Street 1',
          line2: null,
          city: 'Old City',
          pincode: '560002',
        },
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: '1111111111',
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: 'old@example.com',
        seller_nature_of_business_snapshot: 'Manufacturing',
        seller_pan_snapshot: 'ABCDE1234F',
        seller_bank_snapshot: {
          accountName: 'Old Bank Account',
          accountNumber: '000111222',
          ifsc: 'SBIN0001234',
          bankName: 'SBI',
        },
        terms_snapshot: 'Strict 15 days',
        logo_storage_key_snapshot: 'businesses/0001/old-logo.png',
      };

      const resolved = resolveSellerDetails(docRow, mockLiveBusiness);

      expect(resolved.source).toBe('snapshot');
      expect(resolved.legalName).toBe('Historical Name Pvt Ltd');
      expect(resolved.tradeName).toBe('Old Trade');
      expect(resolved.addressLine1).toBe('Old Street 1');
      expect(resolved.city).toBe('Old City');
      expect(resolved.pincode).toBe('560002');
      expect(resolved.phone).toBe('1111111111');
      expect(resolved.email).toBe('old@example.com');
      expect(resolved.natureOfBusiness).toBe('Manufacturing');
      expect(resolved.bank?.bankName).toBe('SBI');
      expect(resolved.terms).toBe('Strict 15 days');
      expect(resolved.logoStorageKey).toBe('businesses/0001/old-logo.png');
    });

    it('uses live business data for a draft document without a snapshot', () => {
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
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      const resolved = resolveSellerDetails(draftDoc, mockLiveBusiness);

      expect(resolved.source).toBe('live');
      expect(resolved.legalName).toBe(mockLiveBusiness.legal_name);
      expect(resolved.gstin).toBe(mockLiveBusiness.gstin);
      expect(resolved.stateCode).toBe(mockLiveBusiness.state_code);
    });

    it('throws SELLER_SNAPSHOT_MISSING when a finalized document lacks a snapshot', () => {
      const finalizedWithoutSnapshot: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: null,
        seller_trade_name_snapshot: null,
        seller_address_snapshot: null,
        seller_state_code_snapshot: null,
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      expect(() => resolveSellerDetails(finalizedWithoutSnapshot, mockLiveBusiness)).toThrow(
        SellerSnapshotError,
      );
      try {
        resolveSellerDetails(finalizedWithoutSnapshot, mockLiveBusiness);
      } catch (err) {
        expect(err).toBeInstanceOf(SellerSnapshotError);
        expect((err as SellerSnapshotError).code).toBe('SELLER_SNAPSHOT_MISSING');
      }
    });

    it('throws SELLER_SNAPSHOT_CORRUPT when address JSON is corrupt or non-object', () => {
      const corruptAddressDoc: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme',
        seller_trade_name_snapshot: null,
        seller_address_snapshot: 'not-an-object',
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      expect(() => resolveSellerDetails(corruptAddressDoc, null)).toThrow(
        SellerSnapshotError,
      );
      try {
        resolveSellerDetails(corruptAddressDoc, null);
      } catch (err) {
        expect((err as SellerSnapshotError).code).toBe('SELLER_SNAPSHOT_CORRUPT');
      }
    });

    it('throws SELLER_SNAPSHOT_CORRUPT when bank JSON is corrupt', () => {
      const corruptBankDoc: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme',
        seller_trade_name_snapshot: null,
        seller_address_snapshot: { line1: 'L1', line2: null, city: 'BLR', pincode: '560001' },
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: 'invalid-bank-string',
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      expect(() => resolveSellerDetails(corruptBankDoc, null)).toThrow(
        SellerSnapshotError,
      );
      try {
        resolveSellerDetails(corruptBankDoc, null);
      } catch (err) {
        expect((err as SellerSnapshotError).code).toBe('SELLER_SNAPSHOT_CORRUPT');
      }
    });

    it('throws SELLER_SNAPSHOT_CORRUPT when seller_state_code_snapshot is null on finalized doc', () => {
      const noStateDoc: SellerSnapshotRow = {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme',
        seller_trade_name_snapshot: null,
        seller_address_snapshot: { line1: 'L1', line2: null, city: 'BLR', pincode: '560001' },
        seller_state_code_snapshot: null,
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: null,
      };

      expect(() => resolveSellerDetails(noStateDoc, null)).toThrow(
        SellerSnapshotError,
      );
      try {
        resolveSellerDetails(noStateDoc, null);
      } catch (err) {
        expect((err as SellerSnapshotError).code).toBe('SELLER_SNAPSHOT_CORRUPT');
      }
    });
  });

  describe('toInvoicePrintFields adapter', () => {
    it('outputs the exact key set consumed by InvoicePrintView', () => {
      const details = resolveSellerDetails(
        {
          lifecycle_status: 'finalized',
          seller_gstin_snapshot: '29ABCDE1234F1Z5',
          seller_name_snapshot: 'Acme Corp',
          seller_trade_name_snapshot: 'Acme',
          seller_address_snapshot: { line1: '123 St', line2: null, city: 'Bengaluru', pincode: '560001' },
          seller_state_code_snapshot: '29',
          seller_phone_snapshot: '9876543210',
          seller_alternate_phone_snapshot: null,
          seller_email_snapshot: 'acme@example.com',
          seller_nature_of_business_snapshot: 'Retail',
          seller_pan_snapshot: 'ABCDE1234F',
          seller_bank_snapshot: { accountName: 'Acme', accountNumber: '123', ifsc: 'HDFC001', bankName: 'HDFC' },
          terms_snapshot: 'Terms 123',
          logo_storage_key_snapshot: 'logos/123.png',
        },
        null,
      );

      const fields = toInvoicePrintFields(details);
      const keys = Object.keys(fields).sort();
      expect(keys).toEqual([
        'address_line1',
        'address_line2',
        'alternate_phone',
        'bank_account_number',
        'bank_ifsc',
        'bank_name',
        'business_name',
        'city',
        'invoice_tagline',
        'invoice_terms',
        'logo_storage_key',
        'nature_of_business',
        'phone',
        'pincode',
      ]);
      expect(fields.business_name).toBe('Acme Corp');
      expect(fields.bank_name).toBe('HDFC');
      expect(fields.bank_account_number).toBe('123');
      expect(fields.bank_ifsc).toBe('HDFC001');
      expect(fields.invoice_terms).toBe('Terms 123');
      expect(fields.logo_storage_key).toBe('logos/123.png');
    });
  });

  describe('toCreditNotePrintBusiness adapter', () => {
    it('outputs the exact key set consumed by CreditNotePrintView including logo_url', () => {
      const details = resolveSellerDetails(
        {
          lifecycle_status: 'finalized',
          seller_gstin_snapshot: '29ABCDE1234F1Z5',
          seller_name_snapshot: 'Acme Corp',
          seller_trade_name_snapshot: 'Acme',
          seller_address_snapshot: { line1: '123 St', line2: null, city: 'Bengaluru', pincode: '560001' },
          seller_state_code_snapshot: '29',
          seller_phone_snapshot: '9876543210',
          seller_alternate_phone_snapshot: null,
          seller_email_snapshot: 'acme@example.com',
          seller_nature_of_business_snapshot: 'Retail',
          seller_pan_snapshot: 'ABCDE1234F',
          seller_bank_snapshot: null,
          terms_snapshot: null,
          logo_storage_key_snapshot: 'logos/123.png',
        },
        null,
      );

      const biz = toCreditNotePrintBusiness(details, 'biz-uuid-1');
      const keys = Object.keys(biz).sort();
      expect(keys).toEqual([
        'address_line1',
        'address_line2',
        'city',
        'email',
        'gstin',
        'id',
        'legal_name',
        'logo_storage_key',
        'logo_url',
        'pan',
        'phone',
        'pincode',
        'state_code',
        'trade_name',
      ]);
      expect(biz.id).toBe('biz-uuid-1');
      expect(biz.gstin).toBe('29ABCDE1234F1Z5');
      expect(biz.logo_url).toBe('/api/business/biz-uuid-1/logo?k=logos%2F123.png');
    });

    it('throws SELLER_SNAPSHOT_CORRUPT if gstin is absent', () => {
      const detailsWithoutGstin = resolveSellerDetails(
        {
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
          seller_pan_snapshot: null,
          seller_bank_snapshot: null,
          terms_snapshot: null,
          logo_storage_key_snapshot: null,
        },
        { ...mockLiveBusiness, gstin: '' as unknown as string },
      );
      detailsWithoutGstin.gstin = null;

      expect(() => toCreditNotePrintBusiness(detailsWithoutGstin, 'biz-uuid-1')).toThrow(
        SellerSnapshotError,
      );
    });
  });
});
