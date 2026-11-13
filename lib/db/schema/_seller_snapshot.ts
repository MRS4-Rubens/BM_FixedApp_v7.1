import { jsonb, text, varchar } from 'drizzle-orm/pg-core';

export interface SellerAddressSnapshot {
  line1: string | null;
  line2: string | null;
  city: string | null;
  pincode: string | null;
}

export interface SellerBankSnapshot {
  accountName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
}

export type SellerSnapshotSource = 'captured_at_finalization' | 'backfilled_from_profile';

/** Factory (fresh builders per table). COMP-001: frozen seller details of a finalized legal document. */
export function sellerSnapshotColumns() {
  return {
    seller_name_snapshot: text('seller_name_snapshot'),
    seller_trade_name_snapshot: text('seller_trade_name_snapshot'),
    seller_address_snapshot: jsonb('seller_address_snapshot').$type<SellerAddressSnapshot>(),
    seller_state_code_snapshot: varchar('seller_state_code_snapshot', { length: 2 }),
    seller_phone_snapshot: text('seller_phone_snapshot'),
    seller_alternate_phone_snapshot: text('seller_alternate_phone_snapshot'),
    seller_email_snapshot: text('seller_email_snapshot'),
    seller_nature_of_business_snapshot: text('seller_nature_of_business_snapshot'),
    seller_pan_snapshot: varchar('seller_pan_snapshot', { length: 10 }),
    seller_bank_snapshot: jsonb('seller_bank_snapshot').$type<SellerBankSnapshot>(),
    terms_snapshot: text('terms_snapshot'),
    logo_storage_key_snapshot: text('logo_storage_key_snapshot'),
    signature_storage_key_snapshot: text('signature_storage_key_snapshot'),
    seller_snapshot_source: text('seller_snapshot_source').$type<SellerSnapshotSource>(),
  };
}
