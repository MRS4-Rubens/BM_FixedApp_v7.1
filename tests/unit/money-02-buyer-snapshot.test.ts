import { describe, expect, it } from 'vitest';
import { normalizeBuyerGstin, resolveBuyerSnapshot } from '@/lib/invoices/buyer-snapshot';

/** MONEY-02: the finalized invoice must say what the user saw on the draft preview. */
const customer = {
  name: 'Sharma Traders',
  address_line1: '12 MG Road',
  address_line2: null,
  city: 'Pune',
  state_code: '27',
  pincode: '411001',
};

const draft = (name: string | null, gstin: string | null) => ({
  billing_name_snapshot: name,
  billing_gstin_snapshot: gstin,
  billing_address_snapshot: null,
});

describe('MONEY-02: buyer snapshot at finalize', () => {
  it('keeps the GSTIN typed on the draft when the saved customer has none (the reported bug)', () => {
    const buyer = resolveBuyerSnapshot(draft('Sharma Traders', '27AAPFU0939F1ZV'), { ...customer });
    expect(buyer.billingGstin).toBe('27AAPFU0939F1ZV');
    expect(buyer.billingAddress).toBe('12 MG Road\nPune, 27, 411001');
  });

  it('keeps a corrected GSTIN instead of the saved customer GSTIN', () => {
    expect(resolveBuyerSnapshot(draft('Sharma Traders', '27aapfu0939f1zv '), customer).billingGstin).toBe('27AAPFU0939F1ZV');
  });

  it('a GSTIN cleared on the draft stays cleared (B2C, as previewed)', () => {
    expect(resolveBuyerSnapshot(draft('Sharma Traders', ''), customer).billingGstin).toBeNull();
    expect(resolveBuyerSnapshot(draft('Sharma Traders', null), customer).billingGstin).toBeNull();
  });

  it('a linked customer still supplies the name (editing the name in the form unlinks the customer)', () => {
    expect(resolveBuyerSnapshot(draft('Old Name', '27AAPFU0939F1ZV'), customer).billingName).toBe('Sharma Traders');
  });

  it('an ad-hoc buyer (no saved customer) keeps the draft values unchanged', () => {
    const buyer = resolveBuyerSnapshot(
      { billing_name_snapshot: 'Walk-in', billing_gstin_snapshot: null, billing_address_snapshot: null },
      null,
    );
    expect(buyer).toEqual({ billingName: 'Walk-in', billingGstin: null, billingAddress: null });
  });

  it('normalizes GSTINs (trim, upper case, empty = none)', () => {
    expect(normalizeBuyerGstin(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(normalizeBuyerGstin('')).toBeNull();
    expect(normalizeBuyerGstin(undefined)).toBeNull();
  });
});
