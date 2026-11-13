import { describe, expect, it } from 'vitest';
import {
  captureSellerSnapshot,
  resolveSellerDetails,
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
  logo_storage_key: 'logos/0001/logo-123.png',
  signature_storage_key: 'signatures/0001/sig-abc.png',
  bank_account_name: 'Acme Tech Primary',
  bank_account_number: '123456789012',
  bank_ifsc: 'HDFC0001234',
  bank_name: 'HDFC Bank',
  invoice_terms: 'Payment due within 30 days.',
};

describe('SPEC: Authorised signature seller snapshot (SIG-A)', () => {
  it('captureSellerSnapshot copies signature_storage_key to signature_storage_key_snapshot', () => {
    const snapshotWithSig = captureSellerSnapshot(mockLiveBusiness);
    expect(snapshotWithSig.signature_storage_key_snapshot).toBe('signatures/0001/sig-abc.png');

    const snapshotNoSig = captureSellerSnapshot({
      ...mockLiveBusiness,
      signature_storage_key: null,
    });
    expect(snapshotNoSig.signature_storage_key_snapshot).toBeNull();
  });

  it('resolveSellerDetails for a finalized doc with null signature snapshot does NOT throw and returns signatureStorageKey null', () => {
    const finalizedDocLegacy: SellerSnapshotRow = {
      lifecycle_status: 'finalized',
      seller_gstin_snapshot: '29ABCDE1234F1Z5',
      seller_name_snapshot: 'Acme Technologies Pvt Ltd',
      seller_trade_name_snapshot: 'Acme Tech',
      seller_address_snapshot: {
        line1: '123 Innovation Way',
        line2: 'Block B, 4th Floor',
        city: 'Bengaluru',
        pincode: '560001',
      },
      seller_state_code_snapshot: '29',
      seller_phone_snapshot: '+91 9876543210',
      seller_alternate_phone_snapshot: null,
      seller_email_snapshot: 'billing@acme.com',
      seller_nature_of_business_snapshot: null,
      seller_pan_snapshot: 'ABCDE1234F',
      seller_bank_snapshot: null,
      terms_snapshot: 'Net 30',
      logo_storage_key_snapshot: 'logos/0001/logo.png',
      // Legacy document without signature snapshot column populated:
      signature_storage_key_snapshot: null,
    };

    expect(() => resolveSellerDetails(finalizedDocLegacy, null)).not.toThrow();
    const details = resolveSellerDetails(finalizedDocLegacy, null);
    expect(details.source).toBe('snapshot');
    expect(details.signatureStorageKey).toBeNull();
  });

  it('resolveSellerDetails for a finalized doc with signature snapshot returns signatureStorageKey', () => {
    const finalizedDoc: SellerSnapshotRow = {
      lifecycle_status: 'finalized',
      seller_gstin_snapshot: '29ABCDE1234F1Z5',
      seller_name_snapshot: 'Acme Technologies Pvt Ltd',
      seller_trade_name_snapshot: 'Acme Tech',
      seller_address_snapshot: {
        line1: '123 Innovation Way',
        line2: null,
        city: 'Bengaluru',
        pincode: '560001',
      },
      seller_state_code_snapshot: '29',
      seller_phone_snapshot: null,
      seller_alternate_phone_snapshot: null,
      seller_email_snapshot: null,
      seller_nature_of_business_snapshot: null,
      seller_pan_snapshot: null,
      seller_bank_snapshot: null,
      terms_snapshot: null,
      logo_storage_key_snapshot: null,
      signature_storage_key_snapshot: 'signatures/0001/frozen-sig.png',
    };

    const details = resolveSellerDetails(finalizedDoc, null);
    expect(details.source).toBe('snapshot');
    expect(details.signatureStorageKey).toBe('signatures/0001/frozen-sig.png');
  });

  it('resolveSellerDetails for draft uses live business signature key', () => {
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
      signature_storage_key_snapshot: null,
    };

    const detailsWithSig = resolveSellerDetails(draftDoc, mockLiveBusiness);
    expect(detailsWithSig.source).toBe('live');
    expect(detailsWithSig.signatureStorageKey).toBe('signatures/0001/sig-abc.png');

    const detailsNoSig = resolveSellerDetails(draftDoc, {
      ...mockLiveBusiness,
      signature_storage_key: null,
    });
    expect(detailsNoSig.source).toBe('live');
    expect(detailsNoSig.signatureStorageKey).toBeNull();
  });

  it('toInvoicePrintFields and toCreditNotePrintBusiness do NOT expose signature as key or URL', () => {
    const details = resolveSellerDetails(
      {
        lifecycle_status: 'finalized',
        seller_gstin_snapshot: '29ABCDE1234F1Z5',
        seller_name_snapshot: 'Acme Technologies Pvt Ltd',
        seller_trade_name_snapshot: null,
        seller_address_snapshot: { line1: 'L1', line2: null, city: 'C', pincode: 'P' },
        seller_state_code_snapshot: '29',
        seller_phone_snapshot: null,
        seller_alternate_phone_snapshot: null,
        seller_email_snapshot: null,
        seller_nature_of_business_snapshot: null,
        seller_pan_snapshot: null,
        seller_bank_snapshot: null,
        terms_snapshot: null,
        logo_storage_key_snapshot: 'logos/0001/logo.png',
        signature_storage_key_snapshot: 'signatures/0001/sig.png',
      },
      null,
    );

    const invoiceFields = toInvoicePrintFields(details);
    expect((invoiceFields as Record<string, unknown>).signature_storage_key).toBeUndefined();
    expect((invoiceFields as Record<string, unknown>).signature_url).toBeUndefined();
    expect((invoiceFields as Record<string, unknown>).signatureStorageKey).toBeUndefined();

    const creditNoteBusiness = toCreditNotePrintBusiness(details, 'biz_001');
    expect((creditNoteBusiness as Record<string, unknown>).signature_storage_key).toBeUndefined();
    expect((creditNoteBusiness as Record<string, unknown>).signature_url).toBeUndefined();
    expect((creditNoteBusiness as Record<string, unknown>).signatureStorageKey).toBeUndefined();
  });
});

