import type { InferSelectModel } from 'drizzle-orm';
import type { businesses } from '@/lib/db/schema';
import type { SellerAddressSnapshot, SellerBankSnapshot, SellerSnapshotSource } from '@/lib/db/schema/_seller_snapshot';
import { buildLogoUrl } from '@/lib/storage/logo-url';

type BusinessRow = InferSelectModel<typeof businesses>;
export type LiveBusinessSeller = Pick<BusinessRow,
  'id' | 'legal_name' | 'trade_name' | 'gstin' | 'pan' | 'address_line1' | 'address_line2' | 'city' | 'state_code' |
  'pincode' | 'phone' | 'alternate_phone' | 'email' | 'nature_of_business' | 'logo_storage_key' |
  'bank_account_name' | 'bank_account_number' | 'bank_ifsc' | 'bank_name' | 'invoice_terms'>;

/** Values written to the snapshot columns at finalization. */
export interface SellerSnapshotValues {
  seller_name_snapshot: string;
  seller_trade_name_snapshot: string | null;
  seller_address_snapshot: SellerAddressSnapshot;
  seller_state_code_snapshot: string;
  seller_phone_snapshot: string | null;
  seller_alternate_phone_snapshot: string | null;
  seller_email_snapshot: string | null;
  seller_nature_of_business_snapshot: string | null;
  seller_pan_snapshot: string | null;
  seller_bank_snapshot: SellerBankSnapshot | null;
  terms_snapshot: string | null;
  logo_storage_key_snapshot: string | null;
  seller_snapshot_source: SellerSnapshotSource; // always 'captured_at_finalization' here
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

export function captureSellerSnapshot(business: LiveBusinessSeller): SellerSnapshotValues {
  const isBankBlank =
    isBlank(business.bank_account_name) &&
    isBlank(business.bank_account_number) &&
    isBlank(business.bank_ifsc) &&
    isBlank(business.bank_name);

  const seller_bank_snapshot: SellerBankSnapshot | null = isBankBlank
    ? null
    : {
      accountName: business.bank_account_name ?? null,
      accountNumber: business.bank_account_number ?? null,
      ifsc: business.bank_ifsc ?? null,
      bankName: business.bank_name ?? null,
    };

  return {
    seller_name_snapshot: business.legal_name,
    seller_trade_name_snapshot: business.trade_name ?? null,
    seller_address_snapshot: {
      line1: business.address_line1 ?? null,
      line2: business.address_line2 ?? null,
      city: business.city ?? null,
      pincode: business.pincode ?? null,
    },
    seller_state_code_snapshot: business.state_code,
    seller_phone_snapshot: business.phone ?? null,
    seller_alternate_phone_snapshot: business.alternate_phone ?? null,
    seller_email_snapshot: business.email ?? null,
    seller_nature_of_business_snapshot: business.nature_of_business ?? null,
    seller_pan_snapshot: business.pan ?? null,
    seller_bank_snapshot,
    terms_snapshot: business.invoice_terms ?? null,
    logo_storage_key_snapshot: business.logo_storage_key ?? null,
    seller_snapshot_source: 'captured_at_finalization',
  };
}

export class SellerSnapshotError extends Error {
  readonly code: 'SELLER_SNAPSHOT_MISSING' | 'SELLER_SNAPSHOT_CORRUPT';
  constructor(code: 'SELLER_SNAPSHOT_MISSING' | 'SELLER_SNAPSHOT_CORRUPT', message: string) {
    super(message);
    this.name = 'SellerSnapshotError';
    this.code = code;
  }
}

/** Structural shape shared by invoice and credit-note rows. */
export interface SellerSnapshotRow {
  lifecycle_status: string;
  seller_gstin_snapshot: string | null;
  seller_name_snapshot: string | null;
  seller_trade_name_snapshot: string | null;
  seller_address_snapshot: unknown; // validated by type guards below, never trusted
  seller_state_code_snapshot: string | null;
  seller_phone_snapshot: string | null;
  seller_alternate_phone_snapshot: string | null;
  seller_email_snapshot: string | null;
  seller_nature_of_business_snapshot: string | null;
  seller_pan_snapshot: string | null;
  seller_bank_snapshot: unknown;
  terms_snapshot: string | null;
  logo_storage_key_snapshot: string | null;
}

export interface SellerDetails {
  source: 'snapshot' | 'live';
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  natureOfBusiness: string | null;
  bank: SellerBankSnapshot | null;
  terms: string | null;
  logoStorageKey: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isSellerAddress(value: unknown): value is SellerAddressSnapshot {
  if (!isPlainObject(value)) return false;
  return (
    isStringOrNull(value.line1) &&
    isStringOrNull(value.line2) &&
    isStringOrNull(value.city) &&
    isStringOrNull(value.pincode)
  );
}

function isSellerBank(value: unknown): value is SellerBankSnapshot {
  if (!isPlainObject(value)) return false;
  return (
    isStringOrNull(value.accountName) &&
    isStringOrNull(value.accountNumber) &&
    isStringOrNull(value.ifsc) &&
    isStringOrNull(value.bankName)
  );
}

export function resolveSellerDetails(
  doc: SellerSnapshotRow,
  live: LiveBusinessSeller | null,
): SellerDetails {
  if (doc.seller_name_snapshot !== null) {
    if (doc.seller_state_code_snapshot === null) {
      throw new SellerSnapshotError(
        'SELLER_SNAPSHOT_CORRUPT',
        'Finalized document has corrupt seller snapshot: missing state code.',
      );
    }
    if (!isSellerAddress(doc.seller_address_snapshot)) {
      throw new SellerSnapshotError(
        'SELLER_SNAPSHOT_CORRUPT',
        'Finalized document has corrupt seller snapshot: invalid address.',
      );
    }

    let bank: SellerBankSnapshot | null = null;
    if (doc.seller_bank_snapshot !== null && doc.seller_bank_snapshot !== undefined) {
      if (!isSellerBank(doc.seller_bank_snapshot)) {
        throw new SellerSnapshotError(
          'SELLER_SNAPSHOT_CORRUPT',
          'Finalized document has corrupt seller snapshot: invalid bank details.',
        );
      }
      bank = {
        accountName: doc.seller_bank_snapshot.accountName ?? null,
        accountNumber: doc.seller_bank_snapshot.accountNumber ?? null,
        ifsc: doc.seller_bank_snapshot.ifsc ?? null,
        bankName: doc.seller_bank_snapshot.bankName ?? null,
      };
    }

    return {
      source: 'snapshot',
      legalName: doc.seller_name_snapshot,
      tradeName: doc.seller_trade_name_snapshot ?? null,
      gstin: doc.seller_gstin_snapshot ?? null,
      pan: doc.seller_pan_snapshot ?? null,
      addressLine1: doc.seller_address_snapshot.line1 ?? null,
      addressLine2: doc.seller_address_snapshot.line2 ?? null,
      city: doc.seller_address_snapshot.city ?? null,
      pincode: doc.seller_address_snapshot.pincode ?? null,
      stateCode: doc.seller_state_code_snapshot,
      phone: doc.seller_phone_snapshot ?? null,
      alternatePhone: doc.seller_alternate_phone_snapshot ?? null,
      email: doc.seller_email_snapshot ?? null,
      natureOfBusiness: doc.seller_nature_of_business_snapshot ?? null,
      bank,
      terms: doc.terms_snapshot ?? null,
      logoStorageKey: doc.logo_storage_key_snapshot ?? null,
    };
  }

  if (doc.lifecycle_status === 'draft' && live) {
    const isBankBlank =
      isBlank(live.bank_account_name) &&
      isBlank(live.bank_account_number) &&
      isBlank(live.bank_ifsc) &&
      isBlank(live.bank_name);

    const bank: SellerBankSnapshot | null = isBankBlank
      ? null
      : {
        accountName: live.bank_account_name ?? null,
        accountNumber: live.bank_account_number ?? null,
        ifsc: live.bank_ifsc ?? null,
        bankName: live.bank_name ?? null,
      };

    return {
      source: 'live',
      legalName: live.legal_name,
      tradeName: live.trade_name ?? null,
      gstin: live.gstin ?? null,
      pan: live.pan ?? null,
      addressLine1: live.address_line1 ?? null,
      addressLine2: live.address_line2 ?? null,
      city: live.city ?? null,
      pincode: live.pincode ?? null,
      stateCode: live.state_code,
      phone: live.phone ?? null,
      alternatePhone: live.alternate_phone ?? null,
      email: live.email ?? null,
      natureOfBusiness: live.nature_of_business ?? null,
      bank,
      terms: live.invoice_terms ?? null,
      logoStorageKey: live.logo_storage_key ?? null,
    };
  }

  throw new SellerSnapshotError(
    'SELLER_SNAPSHOT_MISSING',
    'Finalized document is missing required seller snapshot.',
  );
}

export function toInvoicePrintFields(d: SellerDetails): {
  business_name: string;
  city: string | null;
  phone: string | null;
  nature_of_business: string | null;
  alternate_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  pincode: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  invoice_terms: string | null;
  logo_storage_key: string | null;
} {
  return {
    business_name: d.legalName,
    city: d.city,
    phone: d.phone,
    nature_of_business: d.natureOfBusiness,
    alternate_phone: d.alternatePhone,
    address_line1: d.addressLine1,
    address_line2: d.addressLine2,
    pincode: d.pincode,
    bank_name: d.bank?.bankName ?? null,
    bank_account_number: d.bank?.accountNumber ?? null,
    bank_ifsc: d.bank?.ifsc ?? null,
    invoice_terms: d.terms,
    logo_storage_key: d.logoStorageKey,
  };
}

export function toCreditNotePrintBusiness(
  d: SellerDetails,
  businessId: string,
): {
  id: string;
  legal_name: string;
  trade_name: string | null;
  gstin: string;
  pan: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_code: string;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logo_storage_key: string | null;
  logo_url: string | null;
} {
  if (!d.gstin) {
    throw new SellerSnapshotError('SELLER_SNAPSHOT_CORRUPT', 'Credit note seller snapshot is missing GSTIN.');
  }

  return {
    id: businessId,
    legal_name: d.legalName,
    trade_name: d.tradeName,
    gstin: d.gstin,
    pan: d.pan,
    address_line1: d.addressLine1,
    address_line2: d.addressLine2,
    city: d.city,
    state_code: d.stateCode,
    pincode: d.pincode,
    phone: d.phone,
    email: d.email,
    logo_storage_key: d.logoStorageKey,
    logo_url: d.logoStorageKey ? buildLogoUrl(businessId, d.logoStorageKey) : null,
  };
}
