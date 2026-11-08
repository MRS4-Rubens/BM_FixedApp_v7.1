import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { FORBIDDEN_ROLE_CODE } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import type { ActionResult } from '@/lib/actions/_shared/types';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: null as string | null,
  role: 'owner' as 'owner' | 'staff',
  displayName: 'Test User' as string | null,
  email: 'test@example.com' as string | null,
  isPlatformAdmin: false,
}));

const storageMock = vi.hoisted(() => ({
  uploadCalls: 0,
  deleteCalls: 0,
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    auth_user_id: `auth_${state.userId}`,
    email: state.email,
    business_id: state.businessId,
    role: state.role,
    display_name: state.displayName,
    created_at: new Date(),
    updated_at: new Date(),
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: {
          id: state.userId,
          email: state.email,
          emailVerified: true,
        },
      },
    }),
  },
}));

vi.mock('@/lib/auth/admin', () => ({
  isPlatformAdmin: async () => state.isPlatformAdmin,
  requirePlatformAdmin: async () => {
    if (!state.isPlatformAdmin) {
      throw new ActionError('Unauthorized: Access denied.', { code: 'UNAUTHORIZED_ACCESS' });
    }
    return { id: state.userId, email: state.email ?? 'admin@test.dev', via: 'user_id' };
  },
  getPlatformAdminDecision: async () => ({
    allowed: state.isPlatformAdmin,
    ...(state.isPlatformAdmin
      ? { identity: { id: state.userId, email: state.email ?? 'admin@test.dev', via: 'user_id' } }
      : { reason: 'not_allowlisted' }),
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  emailBurstLimiter: {},
  emailDailyCapLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

vi.mock('@/lib/storage/idrive', () => ({
  uploadFileToStorage: vi.fn(async () => {
    storageMock.uploadCalls++;
    return undefined;
  }),
  deleteFileFromStorage: vi.fn(async () => {
    storageMock.deleteCalls++;
    return undefined;
  }),
  getSignedDownloadUrl: vi.fn(async () => 'https://mock-storage.test/download'),
}));

vi.mock('@/lib/storage/schedule-archival', () => ({
  scheduleArchival: vi.fn(),
}));

vi.mock('@/lib/email/resend', () => ({
  getResend: () => ({
    emails: {
      send: async () => ({ id: 'mock-email-id' }),
    },
  }),
}));

vi.mock('@/lib/env', () => ({
  getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
  getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: ['admin@test.dev'],
    PLATFORM_ADMIN_USER_IDS: ['a0000000-0000-4000-8000-000000000099'],
  }),
}));

import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { uploadBusinessLogo } from '@/lib/actions/business/upload-logo';
import { removeBusinessLogo } from '@/lib/actions/business/remove-logo';
import { saveInvoiceSettings } from '@/lib/actions/invoices/save-invoice-settings';
import { voidPayment } from '@/lib/actions/payments/void-payment';
import { voidCreditNote } from '@/lib/actions/credit-notes/void-credit-note';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';
import { getBusinessSubscriptions } from '@/lib/actions/subscriptions/get-business-subscriptions';

import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { createCustomer } from '@/lib/actions/customers/create-customer';
import { createProduct } from '@/lib/actions/products/create-product';
import { recordPayment } from '@/lib/actions/payments/record-payment';
import { listInvoices } from '@/lib/actions/invoices/list-invoices';
import { listCustomers } from '@/lib/actions/customers/list-customers';
import { getTopCustomers } from '@/lib/actions/reports/get-top-customers';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('journal has no entries array');
  }
  return raw.entries.map((entry: unknown): JournalEntry => {
    if (!isRecord(entry) || typeof entry.tag !== 'string') {
      throw new Error('malformed journal entry');
    }
    return { tag: entry.tag };
  });
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

interface IdRow {
  readonly id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no row returned for: ${sqlText}`);
  }
  return row.id;
}

function expectNotForbiddenRole<T>(result: ActionResult<T>): void {
  if (!result.success) {
    expect(result.error.code).not.toBe(FORBIDDEN_ROLE_CODE);
  }
}

describe('AUTH-003: Role-Based Access Control Integration Tests (PGlite)', () => {
  let pg: PGlite;
  let businessAId: string;
  let businessBId: string;
  let ownerUserId: string;
  let staffUserId: string;
  let foreignOwnerUserId: string;
  let financialYearId: string;
  let finalizedInvoiceId: string;
  let activePaymentId: string;
  let finalizedCreditNoteId: string;
  let draftCreditNoteId: string;

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });

    const journal = readJournal();
    await applyMigrations(pg, journal);

    // 1. Seed Tenant A
    businessAId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, invoice_number_format,
        credit_note_number_prefix, logo_storage_key, bank_name, bank_account_name, bank_account_number, bank_ifsc
      ) VALUES (
        'Tenant A Traders', '29AABCT1332L1ZV', '123 Market Road', 'Bengaluru', '29', '560001',
        'professional', 'active', 'INV/{FY}/{SEQ:4}', 'CN', 'logos/tenant-a.png', 'HDFC Bank', 'Tenant A Traders', '50200012345678', 'HDFC0000123'
      ) RETURNING id`
    );

    financialYearId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current, invoice_sequence_counter, credit_note_sequence_counter)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true, 1, 1) RETURNING id`,
      [businessAId]
    );

    // Users for Tenant A
    ownerUserId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth_owner_a', 'owner@tenanta.com', 'Tenant A Owner', 'owner') RETURNING id`,
      [businessAId]
    );

    staffUserId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth_staff_a', 'staff@tenanta.com', 'Tenant A Staff', 'staff') RETURNING id`,
      [businessAId]
    );

    // 2. Seed Tenant B (for cross-tenant checks)
    businessBId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Tenant B Enterprise', '27AABCT9999L1ZV', '456 Tech Park', 'Mumbai', '27', '400001',
        'professional', 'active'
      ) RETURNING id`
    );

    foreignOwnerUserId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth_owner_b', 'owner@tenantb.com', 'Tenant B Owner', 'owner') RETURNING id`,
      [businessBId]
    );

    // 3. Seed invoice for Tenant A (insert as draft first, add line items, then finalize)
    finalizedInvoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status,
        subtotal_paise, total_cgst_paise, total_sgst_paise, total_tax_paise, grand_total_paise,
        place_of_supply_state_code
      ) VALUES (
        $1, $2, 'DRAFT-SEED-001', 'draft',
        1000000, 90000, 90000, 180000, 1180000, '29'
      ) RETURNING id`,
      [businessAId, financialYearId]
    );

    // Line item for the invoice
    await pg.query(
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement,
        unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise
      ) VALUES ($1, 'Consulting Services', '998311', 1.000, 'NOS', 1000000, 1000000, 18.00, 1180000)`,
      [finalizedInvoiceId]
    );

    // Now finalize the invoice
    await pg.query(
      `UPDATE invoices SET
        invoice_number = 'INV/2026-27/0001',
        invoice_sequence = 1,
        lifecycle_status = 'finalized',
        payment_status = 'partially_paid',
        invoice_date = '2026-10-15',
        due_date = '2026-11-14',
        finalized_at = now(),
        seller_name_snapshot = 'Tenant A Traders',
        seller_address_snapshot = '{"line1": "123 Market Road", "city": "Bengaluru", "pincode": "560001"}'::jsonb,
        seller_state_code_snapshot = '29',
        seller_snapshot_source = 'captured_at_finalization',
        seller_gstin_snapshot = '29AABCT1332L1ZV'
      WHERE id = $1`,
      [finalizedInvoiceId]
    );

    // 4. Seed active payment on the invoice
    activePaymentId = await insertOne(
      pg,
      `INSERT INTO payments (
        business_id, invoice_id, amount_paise, payment_date, payment_method, status, reference_number
      ) VALUES ($1, $2, 500000, '2026-10-16', 'bank_transfer', 'active', 'NEFT12345678') RETURNING id`,
      [businessAId, finalizedInvoiceId]
    );

    // 5. Seed finalized credit note on the invoice
    finalizedCreditNoteId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
        business_id, original_invoice_id, financial_year_id, credit_note_number, credit_note_sequence,
        reason, lifecycle_status, issue_date, finalized_at, status,
        seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
        seller_snapshot_source, seller_gstin_snapshot,
        subtotal_paise, total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'CN/2026-27/0001', 1,
        'Discount post-sale', 'finalized', '2026-10-20', now(), 'active',
        'Tenant A Traders', '{"line1": "123 Market Road", "city": "Bengaluru", "pincode": "560001"}'::jsonb, '29',
        'captured_at_finalization', '29AABCT1332L1ZV',
        100000, 18000, 118000
      ) RETURNING id`,
      [businessAId, finalizedInvoiceId, financialYearId]
    );

    // 6. Seed draft credit note on the invoice
    draftCreditNoteId = await insertOne(
      pg,
      `INSERT INTO credit_notes (
        business_id, original_invoice_id, financial_year_id, credit_note_number,
        reason, lifecycle_status, status, subtotal_paise, total_tax_paise, grand_total_paise
      ) VALUES (
        $1, $2, $3, 'CNDRAFT-001',
        'Damaged Goods Return', 'draft', 'active', 50000, 9000, 59000
      ) RETURNING id`,
      [businessAId, finalizedInvoiceId, financialYearId]
    );
  }, 120_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  beforeEach(() => {
    storageMock.uploadCalls = 0;
    storageMock.deleteCalls = 0;
    state.isPlatformAdmin = false;
  });

  function loginAsStaff(): void {
    state.userId = staffUserId;
    state.businessId = businessAId;
    state.role = 'staff';
    state.displayName = 'Tenant A Staff';
    state.email = 'staff@tenanta.com';
    state.isPlatformAdmin = false;
  }

  function loginAsOwner(): void {
    state.userId = ownerUserId;
    state.businessId = businessAId;
    state.role = 'owner';
    state.displayName = 'Tenant A Owner';
    state.email = 'owner@tenanta.com';
    state.isPlatformAdmin = false;
  }

  function loginAsForeignOwner(): void {
    state.userId = foreignOwnerUserId;
    state.businessId = businessBId;
    state.role = 'owner';
    state.displayName = 'Tenant B Owner';
    state.email = 'owner@tenantb.com';
    state.isPlatformAdmin = false;
  }

  async function getBusinessState(id: string) {
    const res = await pg.query<{
      updated_at: string;
      gstin: string;
      invoice_number_format: string;
      logo_storage_key: string | null;
      bank_name: string | null;
      bank_account_name: string | null;
      bank_account_number: string | null;
      bank_ifsc: string | null;
    }>(
      `SELECT updated_at, gstin, invoice_number_format, logo_storage_key,
              bank_name, bank_account_name, bank_account_number, bank_ifsc
       FROM businesses WHERE id = $1`,
      [id]
    );
    return res.rows[0];
  }

  it('AC2: Staff is forbidden on all 8 owner-only actions and DB/storage is completely untouched', async () => {
    loginAsStaff();

    const baselineBiz = await getBusinessState(businessAId);

    // Helper asserting DB unchanged
    async function assertDatabaseUnchanged(): Promise<void> {
      const currentBiz = await getBusinessState(businessAId);
      expect(new Date(currentBiz.updated_at).getTime()).toBe(new Date(baselineBiz.updated_at).getTime());
      expect(currentBiz.gstin).toBe(baselineBiz.gstin);
      expect(currentBiz.invoice_number_format).toBe(baselineBiz.invoice_number_format);
      expect(currentBiz.logo_storage_key).toBe(baselineBiz.logo_storage_key);
      expect(currentBiz.bank_name).toBe(baselineBiz.bank_name);
      expect(currentBiz.bank_account_name).toBe(baselineBiz.bank_account_name);
      expect(currentBiz.bank_account_number).toBe(baselineBiz.bank_account_number);
      expect(currentBiz.bank_ifsc).toBe(baselineBiz.bank_ifsc);

      // Payment still active
      const pmtRes = await pg.query<{ status: string }>('SELECT status FROM payments WHERE id = $1', [activePaymentId]);
      expect(pmtRes.rows[0]?.status).toBe('active');

      // Credit notes: finalized still active (not voided), draft still draft
      const cnFinalRes = await pg.query<{ status: string }>('SELECT status FROM credit_notes WHERE id = $1', [finalizedCreditNoteId]);
      expect(cnFinalRes.rows[0]?.status).toBe('active');
      const cnDraftRes = await pg.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM credit_notes WHERE id = $1', [draftCreditNoteId]);
      expect(cnDraftRes.rows[0]?.lifecycle_status).toBe('draft');

      // Subscription requests count 0
      const subReqs = await pg.query<{ count: string }>('SELECT count(*)::text as count FROM subscription_requests');
      expect(Number(subReqs.rows[0]?.count)).toBe(0);

      // Storage mock never called
      expect(storageMock.uploadCalls).toBe(0);
      expect(storageMock.deleteCalls).toBe(0);
    }

    // 1. saveBusinessProfile
    const res1 = await saveBusinessProfile({
      legal_name: 'Hacked Business Profile',
      gstin: '29AABCT1332L1ZV',
      registration_type: 'regular',
      address_line1: '999 Rogue Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });
    expect(res1.success).toBe(false);
    if (!res1.success) expect(res1.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 2. uploadBusinessLogo
    const res2 = await uploadBusinessLogo({
      base64Data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    expect(res2.success).toBe(false);
    if (!res2.success) expect(res2.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 3. removeBusinessLogo
    const res3 = await removeBusinessLogo({});
    expect(res3.success).toBe(false);
    if (!res3.success) expect(res3.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 4. saveInvoiceSettings
    const res4 = await saveInvoiceSettings({
      invoice_number_format: 'ATK/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      payment_due_days: 15,
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'Malicious Terms',
    });
    expect(res4.success).toBe(false);
    if (!res4.success) expect(res4.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 5. voidPayment
    const res5 = await voidPayment({
      id: activePaymentId,
      reason: 'clerical_error',
      notes: 'Rogue void attempt by staff',
    });
    expect(res5.success).toBe(false);
    if (!res5.success) expect(res5.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 6. voidCreditNote
    const res6 = await voidCreditNote({
      id: finalizedCreditNoteId,
      reason: 'clerical_error',
      confirm: true,
      notes: 'Rogue void attempt by staff',
    });
    expect(res6.success).toBe(false);
    if (!res6.success) expect(res6.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 7. finalizeCreditNote
    const res7 = await finalizeCreditNote({
      id: draftCreditNoteId,
    });
    expect(res7.success).toBe(false);
    if (!res7.success) expect(res7.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();

    // 8. submitPaymentClaim
    const res8 = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'yearly',
      payment_method: 'upi_id',
      payment_reference: '123456789012',
    });
    expect(res8.success).toBe(false);
    if (!res8.success) expect(res8.error.code).toBe(FORBIDDEN_ROLE_CODE);
    await assertDatabaseUnchanged();
  });

  it('AC3: Staff is allowed to perform day-to-day operations and read reports', async () => {
    loginAsStaff();

    // 1. createCustomer -> success
    const custRes = await createCustomer({
      name: 'Retail Customer Alpha',
      state_code: '29',
    });
    expect(custRes.success).toBe(true);
    const custRow = await pg.query<{ id: string }>(
      'SELECT id FROM customers WHERE business_id = $1 AND name = $2 LIMIT 1',
      [businessAId, 'Retail Customer Alpha']
    );
    const customerId = custRow.rows[0]?.id;

    // 2. createProduct -> success
    const prodRes = await createProduct({
      name: 'Standard Ledger Book',
      hsn_sac_code: '4820',
      unit_of_measurement: 'NOS',
      default_sale_price: '500.00',
    });
    expect(prodRes.success).toBe(true);

    // 3. listCustomers -> success
    const listCustRes = await listCustomers({});
    expect(listCustRes.success).toBe(true);

    // 4. listInvoices -> success
    const listInvRes = await listInvoices({});
    expect(listInvRes.success).toBe(true);

    // 5. getTopCustomers (reports read) -> success
    const topCustRes = await getTopCustomers({
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      limit: 5,
    });
    expect(topCustRes.success).toBe(true);

    // 6. saveInvoiceDraft -> allowed (no FORBIDDEN_ROLE)
    const draftRes = await saveInvoiceDraft({
      customer_id: customerId,
      invoice_date: '2026-10-22',
      due_date: '2026-11-21',
      place_of_supply_state_code: '29',
      line_items: [
        {
          description: 'Office stationery item',
          hsn_sac_code: '4820',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: '500.00',
          tax_rate_percentage: 18,
        },
      ],
    });
    expectNotForbiddenRole(draftRes);

    // 7. finalizeInvoice -> allowed by role (no FORBIDDEN_ROLE)
    const finRes = await finalizeInvoice({ id: finalizedInvoiceId });
    expectNotForbiddenRole(finRes);

    // 8. recordPayment -> allowed by role (no FORBIDDEN_ROLE)
    const payRes = await recordPayment({
      invoice_id: finalizedInvoiceId,
      amount: '100.00',
      payment_date: '2026-10-22',
      payment_method: 'upi',
    });
    expectNotForbiddenRole(payRes);
  });

  it('Owner passes the role gate on every owner-only action (never FORBIDDEN_ROLE)', async () => {
    loginAsOwner();

    // 1. saveBusinessProfile
    const res1 = await saveBusinessProfile({
      legal_name: 'Tenant A Traders (Updated)',
      gstin: '29AABCT1332L1ZV',
      registration_type: 'regular',
      address_line1: '123 Market Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
    });
    expectNotForbiddenRole(res1);

    // 2. uploadBusinessLogo
    const res2 = await uploadBusinessLogo({
      base64Data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    expectNotForbiddenRole(res2);

    // 3. removeBusinessLogo
    const res3 = await removeBusinessLogo({});
    expectNotForbiddenRole(res3);

    // 4. saveInvoiceSettings
    const res4 = await saveInvoiceSettings({
      invoice_number_format: 'INV/{FY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      payment_due_days: 30,
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      invoice_terms: 'Owner Approved Terms',
    });
    expectNotForbiddenRole(res4);

    // 5. voidPayment (attempt on existing payment)
    const res5 = await voidPayment({
      id: activePaymentId,
      reason: 'clerical_error',
      notes: 'Legitimate owner voiding',
    });
    expectNotForbiddenRole(res5);

    // 6. voidCreditNote
    const res6 = await voidCreditNote({
      id: finalizedCreditNoteId,
      reason: 'clerical_error',
      confirm: true,
      notes: 'Legitimate owner voiding',
    });
    expectNotForbiddenRole(res6);

    // 7. finalizeCreditNote
    const res7 = await finalizeCreditNote({
      id: draftCreditNoteId,
    });
    expectNotForbiddenRole(res7);

    // 8. submitPaymentClaim
    const res8 = await submitPaymentClaim({
      plan_name: 'essentials',
      billing_cycle: 'yearly',
      payment_method: 'upi_id',
      payment_reference: 'UTR987654321012',
    });
    expectNotForbiddenRole(res8);
  });

  it('AC6: getBusinessSubscriptions enforces owner-or-platform-admin logic', async () => {
    // 1. Staff of same business -> UNAUTHORIZED_ACCESS
    loginAsStaff();
    const staffRes = await getBusinessSubscriptions({ business_id: businessAId });
    expect(staffRes.success).toBe(false);
    if (!staffRes.success) {
      expect(staffRes.error.code).toBe('UNAUTHORIZED_ACCESS');
    }

    // 2. Owner of same business -> success
    loginAsOwner();
    const ownerRes = await getBusinessSubscriptions({ business_id: businessAId });
    expect(ownerRes.success).toBe(true);

    // 3. Owner of different business -> UNAUTHORIZED_ACCESS
    loginAsForeignOwner();
    const foreignRes = await getBusinessSubscriptions({ business_id: businessAId });
    expect(foreignRes.success).toBe(false);
    if (!foreignRes.success) {
      expect(foreignRes.error.code).toBe('UNAUTHORIZED_ACCESS');
    }

    // 4. Platform admin -> success for any business
    state.isPlatformAdmin = true;
    const adminRes = await getBusinessSubscriptions({ business_id: businessAId });
    expect(adminRes.success).toBe(true);
  });

  it('Payload tampering prevention: passing role: "owner" in input does not elevate staff', async () => {
    loginAsStaff();

    // Raw payload tampering attempt
    const tamperedPayload = {
      legal_name: 'Privilege Escalation Attempt',
      gstin: '29AABCT1332L1ZV',
      registration_type: 'regular',
      address_line1: '123 Market Road',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      role: 'owner',
    };

    const res = await saveBusinessProfile(tamperedPayload);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe(FORBIDDEN_ROLE_CODE);
    }
  });
});