import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { FORBIDDEN_ROLE_CODE } from '@/lib/auth/rbac';
import { ActionError } from '@/lib/actions/_shared/errors';
import { SUPPORT_EMAIL } from '@/lib/config/contact';
import {
  buildGstinTakenMessage,
  buildIdentityLockedMessage,
} from '@/lib/business/identity-policy';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: null as string | null,
  role: 'owner' as 'owner' | 'staff',
  displayName: 'Test User' as string | null,
  email: 'test@example.com' as string | null,
  isPlatformAdmin: false,
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
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { adminUpdateBusinessIdentity } from '@/lib/actions/business/admin-update-business-identity';
import { saveBusinessProfileInTransaction } from '@/lib/business/save-profile-tx';
import { businessProfileSchema } from '@/lib/validations/business';

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

describe('AUTH-004: GSTIN Squatting, Idempotent First-Time Setup & Identity Lock (PGlite)', () => {
  let pg: PGlite;
  const userAId = '00000000-0000-4000-8000-000000000001';
  const userBId = '00000000-0000-4000-8000-000000000002';
  const userCId = '00000000-0000-4000-8000-000000000003';
  const userDId = '00000000-0000-4000-8000-000000000004';
  const userEId = '00000000-0000-4000-8000-000000000005';
  const adminUserId = '00000000-0000-4000-8000-000000000099';

  const GSTIN_A = '29AABCT1332L1ZV';
  const GSTIN_D = '29XYZAB1234C1Z1';
  const GSTIN_E = '29ABCDE1234F1Z5';

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });

    const journal = readJournal();
    await applyMigrations(pg, journal);

    // Seed users with NO business
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, role, display_name, business_id) VALUES
        ($1, 'auth_1', 'user_a@test.dev', 'owner', 'User A', NULL),
        ($2, 'auth_2', 'user_b@test.dev', 'owner', 'User B', NULL),
        ($3, 'auth_3', 'user_c@test.dev', 'owner', 'User C', NULL),
        ($4, 'auth_4', 'user_d@test.dev', 'owner', 'User D', NULL),
        ($5, 'auth_5', 'user_e@test.dev', 'owner', 'User E', NULL),
        ($6, 'auth_admin', 'admin@test.dev', 'owner', 'Admin User', NULL)`,
      [userAId, userBId, userCId, userDId, userEId, adminUserId]
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(() => {
    state.isPlatformAdmin = false;
  });

  function loginAs(userId: string, businessId: string | null = null, role: 'owner' | 'staff' = 'owner'): void {
    state.userId = userId;
    state.businessId = businessId;
    state.role = role;
    state.isPlatformAdmin = false;
  }

  it('1. Two users, same GSTIN: user A succeeds; user B gets GSTIN_ALREADY_REGISTERED with rollback', async () => {
    loginAs(userAId, null);

    const resA = await saveBusinessProfile({
      legal_name: 'Tenant Alpha',
      gstin: GSTIN_A,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '123 Market Road',
      city: 'Bengaluru',
      pincode: '560001',
    });
    expect(resA.success).toBe(true);
    if (!resA.success) return;
    const businessAId = resA.data.businessId;

    // Verify user A is now linked to businessAId
    const userARow = await pg.query<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userAId]
    );
    expect(userARow.rows[0]?.business_id).toBe(businessAId);

    // Now User B tries the SAME GSTIN
    loginAs(userBId, null);
    const resB = await saveBusinessProfile({
      legal_name: 'Tenant Beta Imposter',
      gstin: GSTIN_A,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '456 Fake Street',
      city: 'Bengaluru',
      pincode: '560001',
    });

    expect(resB.success).toBe(false);
    if (resB.success) return;

    expect(resB.error.code).toBe('GSTIN_ALREADY_REGISTERED');
    expect(resB.error.fieldErrors?.gstin?.[0]).toBe(buildGstinTakenMessage());

    // Assert B's users.business_id is still NULL
    const userBRow = await pg.query<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userBId]
    );
    expect(userBRow.rows[0]?.business_id).toBeNull();

    // Assert businesses count = 1 and financial_years count = 1 (complete rollback)
    const bizCount = await pg.query<{ count: string | number }>(
      'SELECT count(*) as count FROM businesses WHERE gstin = $1',
      [GSTIN_A]
    );
    expect(Number(bizCount.rows[0]?.count)).toBe(1);

    const fyCount = await pg.query<{ count: string | number }>(
      'SELECT count(*) as count FROM financial_years WHERE business_id = $1',
      [businessAId]
    );
    expect(Number(fyCount.rows[0]?.count)).toBe(1);
  });

  it('2. Lower-case GSTIN input collides (zod transforms to upper) and returns same error', async () => {
    loginAs(userCId, null);

    const resC = await saveBusinessProfile({
      legal_name: 'Tenant Charlie',
      gstin: GSTIN_A.toLowerCase(), // lowercase input
      state_code: '29',
      registration_type: 'regular',
      address_line1: '789 Lowercase Lane',
      city: 'Bengaluru',
      pincode: '560001',
    });

    expect(resC.success).toBe(false);
    if (resC.success) return;

    expect(resC.error.code).toBe('GSTIN_ALREADY_REGISTERED');
    expect(resC.error.fieldErrors?.gstin?.[0]).toBe(buildGstinTakenMessage());

    const userCRow = await pg.query<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userCId]
    );
    expect(userCRow.rows[0]?.business_id).toBeNull();
  });

  it('3. Edit path: owner of business X changing GSTIN to already-registered GSTIN gets GSTIN_ALREADY_REGISTERED', async () => {
    loginAs(userDId, null);

    // First, user D creates Business X
    const resD = await saveBusinessProfile({
      legal_name: 'Tenant Delta',
      gstin: GSTIN_D,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '100 Delta Blvd',
      city: 'Bengaluru',
      pincode: '560001',
    });
    expect(resD.success).toBe(true);
    if (!resD.success) return;
    const businessDId = resD.data.businessId;

    // User D is now linked
    loginAs(userDId, businessDId);

    // User D attempts to edit GSTIN to Business A's GSTIN
    const resEdit = await saveBusinessProfile({
      legal_name: 'Tenant Delta (Updated)',
      gstin: GSTIN_A, // collision with Business A
      state_code: '29',
      registration_type: 'regular',
      address_line1: '100 Delta Blvd',
      city: 'Bengaluru',
      pincode: '560001',
    });

    expect(resEdit.success).toBe(false);
    if (resEdit.success) return;

    expect(resEdit.error.code).toBe('GSTIN_ALREADY_REGISTERED');
    expect(resEdit.error.fieldErrors?.gstin?.[0]).toBe(buildGstinTakenMessage());

    // Row unchanged in DB
    const bizRow = await pg.query<{ gstin: string }>(
      'SELECT gstin FROM businesses WHERE id = $1',
      [businessDId]
    );
    expect(bizRow.rows[0]?.gstin).toBe(GSTIN_D);
  });

  it('4. Idempotent first-time: sequential calls for same user produce created then updated, same businessId, exactly 1 business and 1 FY row', async () => {
    const payload = businessProfileSchema.parse({
      legal_name: 'Tenant Echo',
      gstin: GSTIN_E,
      state_code: '29',
      registration_type: 'regular' as const,
      address_line1: '200 Echo Road',
      city: 'Bengaluru',
      pincode: '560001',
    });

    const result1 = await (state.db as import('@/lib/db/client').DbTransaction).transaction((tx) =>
      saveBusinessProfileInTransaction(tx, {
        userId: userEId,
        profile: payload,
      })
    );

    expect(result1.mode).toBe('created');
    const createdBusinessId = result1.businessId;

    // Second call with same params
    const result2 = await (state.db as import('@/lib/db/client').DbTransaction).transaction((tx) =>
      saveBusinessProfileInTransaction(tx, {
        userId: userEId,
        profile: payload,
      })
    );

    expect(result2.mode).toBe('updated');
    expect(result2.businessId).toBe(createdBusinessId);

    // Verify exactly 1 business and 1 FY row exist
    const bizRows = await pg.query<{ count: string | number }>(
      'SELECT count(*) as count FROM businesses WHERE gstin = $1',
      [GSTIN_E]
    );
    expect(Number(bizRows.rows[0]?.count)).toBe(1);

    const fyRows = await pg.query<{ count: string | number }>(
      'SELECT count(*) as count FROM financial_years WHERE business_id = $1',
      [createdBusinessId]
    );
    expect(Number(fyRows.rows[0]?.count)).toBe(1);

    const userERow = await pg.query<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userEId]
    );
    expect(userERow.rows[0]?.business_id).toBe(createdBusinessId);
  });

  it('5. Identity lock: draft invoice allows GSTIN change + audit; finalized invoice rejects with IDENTITY_LOCKED', async () => {
    // User E's business
    const userERow = await pg.query<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userEId]
    );
    const businessEId = userERow.rows[0]?.business_id;
    if (!businessEId) throw new Error('user E business not found');

    loginAs(userEId, businessEId);

    const fyRes = await pg.query<{ id: string }>(
      'SELECT id FROM financial_years WHERE business_id = $1 LIMIT 1',
      [businessEId]
    );
    const fyId = fyRes.rows[0]?.id;
    if (!fyId) throw new Error('user E financial year not found');

    // 5a. Insert a DRAFT invoice
    const draftInvRes = await pg.query<{ id: string }>(
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date,
        place_of_supply_state_code, subtotal_paise, total_tax_paise,
        total_cgst_paise, total_sgst_paise, total_igst_paise, grand_total_paise
      ) VALUES (
        $1, $2, 'INV/26-27/0001', 'draft', '2026-10-22',
        '29', 100000, 18000, 9000, 9000, 0, 118000
      ) RETURNING id`,
      [businessEId, fyId]
    );
    const draftInvoiceId = draftInvRes.rows[0]?.id;

    // GSTIN change allowed when only draft exists
    const GSTIN_E_NEW = '29ABCDE1234F1Z6';
    const resAllow = await saveBusinessProfile({
      legal_name: 'Tenant Echo (Renamed)',
      gstin: GSTIN_E_NEW,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '200 Echo Road',
      city: 'Bengaluru',
      pincode: '560001',
    });
    expect(resAllow.success).toBe(true);

    // Check audit_log row for business_identity_changed
    const auditRes = await pg.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_log
       WHERE business_id = $1 AND action = 'business_identity_changed'
       ORDER BY created_at DESC LIMIT 1`,
      [businessEId]
    );
    expect(auditRes.rows[0]?.action).toBe('business_identity_changed');
    expect(auditRes.rows[0]?.metadata).toMatchObject({
      source: 'owner_profile_edit',
      fields: ['gstin'],
      previous: { gstin: GSTIN_E, state_code: '29' },
      next: { gstin: GSTIN_E_NEW, state_code: '29' },
    });

    // 5b. Finalize the draft invoice (with seller snapshots and sequence for statutory compliance)
    await pg.query(
      `INSERT INTO invoice_line_items (
        invoice_id, description, hsn_sac_code, quantity, unit_of_measurement,
        unit_price_paise, taxable_value_paise, tax_rate_percentage, line_total_paise
      ) VALUES ($1, 'Consulting Services', '998311', 1.000, 'NOS', 100000, 100000, 18.00, 118000)`,
      [draftInvoiceId]
    );

    await pg.query(
      `UPDATE invoices SET
        invoice_number = 'INV/2026-27/0001',
        invoice_sequence = 1,
        lifecycle_status = 'finalized',
        invoice_date = '2026-10-15',
        due_date = '2026-11-14',
        finalized_at = now(),
        seller_name_snapshot = 'Tenant Echo',
        seller_gstin_snapshot = $2,
        seller_state_code_snapshot = '29',
        seller_address_snapshot = '{"line1":"200 Echo Road","city":"Bengaluru","state_code":"29","pincode":"560001"}'::jsonb,
        seller_snapshot_source = 'captured_at_finalization'
       WHERE id = $1`,
      [draftInvoiceId, GSTIN_E_NEW]
    );

    // 5c. Now that an invoice is finalized, GSTIN change must be rejected with IDENTITY_LOCKED
    const GSTIN_E_REJECTED = '29ABCDE1234F1Z7';
    const resLockGstin = await saveBusinessProfile({
      legal_name: 'Tenant Echo (Attempted)',
      gstin: GSTIN_E_REJECTED,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '200 Echo Road',
      city: 'Bengaluru',
      pincode: '560001',
    });

    expect(resLockGstin.success).toBe(false);
    if (resLockGstin.success) return;
    expect(resLockGstin.error.code).toBe('IDENTITY_LOCKED');
    expect(resLockGstin.error.fieldErrors?.gstin?.[0]).toBe(
      buildIdentityLockedMessage(SUPPORT_EMAIL)
    );

    // 5d. State-only-differing payload (with consistent prefix) also rejected
    const resLockState = await saveBusinessProfile({
      legal_name: 'Tenant Echo (Attempted)',
      gstin: '27ABCDE1234F1Z6',
      state_code: '27',
      registration_type: 'regular',
      address_line1: '200 Echo Road',
      city: 'Mumbai',
      pincode: '400001',
    });

    expect(resLockState.success).toBe(false);
    if (resLockState.success) return;
    expect(resLockState.error.code).toBe('IDENTITY_LOCKED');
    expect(resLockState.error.fieldErrors?.state_code?.[0]).toBe(
      buildIdentityLockedMessage(SUPPORT_EMAIL)
    );

    // 5e. Payload with SAME gstin/state but different address is allowed
    const resAllowAddress = await saveBusinessProfile({
      legal_name: 'Tenant Echo (Address Edit)',
      gstin: GSTIN_E_NEW,
      state_code: '29',
      registration_type: 'regular',
      address_line1: '999 New Street Road',
      city: 'Bengaluru',
      pincode: '560001',
    });
    expect(resAllowAddress.success).toBe(true);

    const updatedBiz = await pg.query<{ address_line1: string; gstin: string }>(
      'SELECT address_line1, gstin FROM businesses WHERE id = $1',
      [businessEId]
    );
    expect(updatedBiz.rows[0]?.address_line1).toBe('999 New Street Road');
    expect(updatedBiz.rows[0]?.gstin).toBe(GSTIN_E_NEW);
  });

  it('6. Platform admin override works with mandatory reason and audit, rejects non-admins and validation errors', async () => {
    const userERow = await pg.query<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userEId]
    );
    const businessEId = userERow.rows[0]?.business_id;
    if (!businessEId) throw new Error('user E business not found');

    const GSTIN_ADMIN_TARGET = '27ABCDE1234F1Z8';

    // 6a. Non-admin caller -> UNAUTHORIZED_ACCESS
    loginAs(userEId, businessEId);
    state.isPlatformAdmin = false;

    const nonAdminRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: GSTIN_ADMIN_TARGET,
      state_code: '27',
      reason: 'Platform support correcting legally updated state registration.',
    });
    expect(nonAdminRes.success).toBe(false);
    if (!nonAdminRes.success) {
      expect(nonAdminRes.error.code).toBe('UNAUTHORIZED_ACCESS');
    }

    // 6b. Admin caller with reason < 10 chars -> validation error
    loginAs(adminUserId, null);
    state.isPlatformAdmin = true;

    const shortReasonRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: GSTIN_ADMIN_TARGET,
      state_code: '27',
      reason: 'Too short', // 9 characters
    });
    expect(shortReasonRes.success).toBe(false);
    if (!shortReasonRes.success) {
      expect(shortReasonRes.error.code).toBe('VALIDATION_ERROR');
    }

    // 6c. Admin caller with GSTIN/state prefix mismatch -> validation error
    const mismatchRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: '29ABCDE1234F1Z8', // prefix 29
      state_code: '27', // state 27
      reason: 'Platform support correcting legally updated state registration.',
    });
    expect(mismatchRes.success).toBe(false);
    if (!mismatchRes.success) {
      expect(mismatchRes.error.code).toBe('VALIDATION_ERROR');
    }

    // 6d. Duplicate GSTIN -> GSTIN_ALREADY_REGISTERED
    const dupRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: GSTIN_A, // already registered by Business A
      state_code: '29',
      reason: 'Attempting to assign duplicate GSTIN across tenants.',
    });
    expect(dupRes.success).toBe(false);
    if (!dupRes.success) {
      expect(dupRes.error.code).toBe('GSTIN_ALREADY_REGISTERED');
    }

    // 6e. Valid Admin override on business WITH finalized invoices -> SUCCESS
    const validAdminRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: GSTIN_ADMIN_TARGET,
      state_code: '27',
      reason: 'Platform support correcting legally updated state registration.',
    });
    expect(validAdminRes.success).toBe(true);

    // Verify row updated in DB
    const updatedRow = await pg.query<{ gstin: string; state_code: string }>(
      'SELECT gstin, state_code FROM businesses WHERE id = $1',
      [businessEId]
    );
    expect(updatedRow.rows[0]?.gstin).toBe(GSTIN_ADMIN_TARGET);
    expect(updatedRow.rows[0]?.state_code).toBe('27');

    // Verify audit entry
    const adminAudit = await pg.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_log
       WHERE business_id = $1 AND action = 'business_identity_changed_by_admin'
       ORDER BY created_at DESC LIMIT 1`,
      [businessEId]
    );
    expect(adminAudit.rows[0]?.action).toBe('business_identity_changed_by_admin');
    expect(adminAudit.rows[0]?.metadata).toMatchObject({
      source: 'platform_admin',
      reason: 'Platform support correcting legally updated state registration.',
      next: { gstin: GSTIN_ADMIN_TARGET, state_code: '27' },
      had_finalized_invoices: true,
    });

    // 6f. Identical values -> NO_CHANGE
    const noChangeRes = await adminUpdateBusinessIdentity({
      business_id: businessEId,
      gstin: GSTIN_ADMIN_TARGET,
      state_code: '27',
      reason: 'Repeated platform support override request.',
    });
    expect(noChangeRes.success).toBe(false);
    if (!noChangeRes.success) {
      expect(noChangeRes.error.code).toBe('NO_CHANGE');
    }
  });

  it('7. Static guard test: finalize-invoice-tx.ts locks the business row via lockBusinessRow (FOR NO KEY UPDATE)', () => {
    // FOR NO KEY UPDATE conflicts with the profile/identity FOR UPDATE (AUTH-004) AND is exclusive among
    // finalizers (API-010 quota). FOR SHARE satisfied only the first and let concurrent finalizers overshoot quota.
    const src = readFileSync(
      join(process.cwd(), 'lib', 'invoices', 'finalize-invoice-tx.ts'),
      'utf8'
    );
    expect(src).toMatch(/^\s*const business = await lockBusinessRow\(tx, params\.businessId\);/m);
    expect(src).not.toMatch(/\.for\(['"]share['"]\)/);
  });

  it('8. Staff user calling saveBusinessProfile is rejected with FORBIDDEN_ROLE', async () => {
    const userERow = await pg.query<{ business_id: string }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userEId]
    );
    const businessEId = userERow.rows[0]?.business_id;
    if (!businessEId) throw new Error('user E business not found');

    // Create staff member in business E
    const staffId = '00000000-0000-4000-8000-000000000088';
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, role, display_name, business_id)
       VALUES ($1, 'auth_staff_88', 'staff@test.dev', 'staff', 'Staff E', $2)
       ON CONFLICT (id) DO UPDATE SET role = 'staff', business_id = $2`,
      [staffId, businessEId]
    );

    loginAs(staffId, businessEId, 'staff');

    const resStaff = await saveBusinessProfile({
      legal_name: 'Staff Unauthorized Edit',
      gstin: '29STAFF1234F1Z9',
      state_code: '29',
      registration_type: 'regular',
      address_line1: '123 Staff St',
      city: 'Bengaluru',
      pincode: '560001',
    });

    expect(resStaff.success).toBe(false);
    if (!resStaff.success) {
      expect(resStaff.error.code).toBe(FORBIDDEN_ROLE_CODE);
    }
  });
});
