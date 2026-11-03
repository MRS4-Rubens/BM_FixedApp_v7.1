import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/client';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-4000-8000-000000000001',
  businessId: '00000000-0000-4000-8000-000000000010',
}));

vi.mock('@/lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>();
  return {
    ...actual,
    get db() {
      return state.db;
    },
  };
});

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({
      data: {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'owner@test.dev',
          emailVerified: true,
        },
      },
    }),
  },
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
    PLATFORM_ADMIN_EMAILS: ['admin@test.app'],
    PLATFORM_ADMIN_USER_IDS: ['00000000-0000-4000-8000-000000000099'],
  }),
  getArchivalEnv: () => ({ ARCHIVAL_SIGNING_SECRET: 'mock-archival-secret-mock-archival-secret' }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: () => undefined,
}));

vi.mock('@/lib/storage/schedule-archival', () => ({
  scheduleArchival: () => undefined,
}));

import { createCustomer } from '@/lib/actions/customers/create-customer';
import { deleteInvoiceDraft } from '@/lib/actions/invoices/delete-invoice-draft';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { recordPayment } from '@/lib/actions/payments/record-payment';
import { submitPaymentClaim } from '@/lib/actions/subscriptions/submit-payment-claim';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  readonly tag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJournal(): readonly JournalEntry[] {
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

function statementsOf(tag: string): readonly string[] {
  return readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigrations(pg: PGlite, tags: readonly string[]): Promise<void> {
  for (const tag of tags) {
    for (const stmt of statementsOf(tag)) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  readonly id: string;
}

async function insertOne(pg: PGlite, query: string, params: readonly unknown[] = []): Promise<string> {
  const res = await pg.query<IdRow>(query, params as unknown[]);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`Query returned no id: ${query}`);
  return id;
}

describe('API-010: Quota and entitlement integrity (PGlite)', () => {
  let pg: PGlite;
  const journal = readJournal();
  const allTags = journal.map((j) => j.tag);
  const backfillTag = '0024_api010_trial_end_backfill';
  const backfillIdx = allTags.indexOf(backfillTag);
  const tagsBeforeBackfill = backfillIdx >= 0 ? allTags.slice(0, backfillIdx) : allTags.slice(0, -1);

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, allTags);
    const db = drizzle(pg, { schema });
    state.db = db;
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('AC-3: Data migration backfill sets trial_ends_at = created_at + 14 days and is idempotent', async () => {
    const isolatedPg = new PGlite();
    // 1. Apply up to 0023 (before backfill migration)
    await applyMigrations(isolatedPg, tagsBeforeBackfill);

    // 2. Insert trial business with NULL trial_ends_at
    const trialCreatedAt = '2026-01-01 10:00:00+00';
    const trialBizId = await insertOne(
      isolatedPg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, trial_ends_at, created_at
      ) VALUES (
        'Legacy Trial Biz', '27AAPFU0939F1ZV', '10 Main Rd', 'Mumbai', '27', '400001',
        'trial', 'trial', NULL, $1
      ) RETURNING id`,
      [trialCreatedAt],
    );

    // Insert active business with NULL trial_ends_at (should NOT be touched)
    const activeBizId = await insertOne(
      isolatedPg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, trial_ends_at, created_at
      ) VALUES (
        'Active Biz', '27AAPFU0939F1ZW', '11 Main Rd', 'Mumbai', '27', '400001',
        'essentials', 'active', NULL, $1
      ) RETURNING id`,
      [trialCreatedAt],
    );

    // 3. Apply the 0024 migration
    await applyMigrations(isolatedPg, [backfillTag]);

    // 4. Assert trial business has trial_ends_at backfilled to created_at + 14 days
    const trialRes = await isolatedPg.query<{ trial_ends_at: string | Date | null }>(
      `SELECT trial_ends_at FROM businesses WHERE id = $1`,
      [trialBizId],
    );
    expect(trialRes.rows[0]?.trial_ends_at).not.toBeNull();
    const trialEnd = new Date(trialRes.rows[0]?.trial_ends_at ?? 0).toISOString();
    expect(trialEnd).toBe('2026-01-15T10:00:00.000Z');

    // Assert active business was left with NULL trial_ends_at
    const activeRes = await isolatedPg.query<{ trial_ends_at: string | Date | null }>(
      `SELECT trial_ends_at FROM businesses WHERE id = $1`,
      [activeBizId],
    );
    expect(activeRes.rows[0]?.trial_ends_at).toBeNull();

    // 5. Idempotency: re-run the migration SQL statements; assert no errors and identical state
    await applyMigrations(isolatedPg, [backfillTag]);
    const trialRes2 = await isolatedPg.query<{ trial_ends_at: string | Date | null }>(
      `SELECT trial_ends_at FROM businesses WHERE id = $1`,
      [trialBizId],
    );
    expect(new Date(trialRes2.rows[0]?.trial_ends_at ?? 0).toISOString()).toBe('2026-01-15T10:00:00.000Z');

    await isolatedPg.close();
  });

  it('AC-1: Free business with 30+ abandoned drafts can still save drafts AND finalize', async () => {
    // Create a Free/Expired business
    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, trial_ends_at
      ) VALUES (
        'Free Tier Biz', '27AAPFU0939F1ZX', '20 Link Rd', 'Mumbai', '27', '400050',
        'free', 'expired', NULL
      ) RETURNING id`,
    );
    const userId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-user-ac1', 'owner-ac1@test.dev', 'Owner AC1', 'owner') RETURNING id`,
      [bizId],
    );
    const fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [bizId],
    );
    const taxRateId = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 18%', '18.00', true, '2020-01-01') RETURNING id`,
    );

    state.businessId = bizId;
    state.userId = userId;

    // Insert 32 draft invoices directly into DB simulating abandoned drafts
    for (let i = 1; i <= 32; i++) {
      await pg.query(
        `INSERT INTO invoices (
          business_id, financial_year_id, invoice_number, lifecycle_status, subtotal_paise, total_tax_paise, grand_total_paise,
          invoice_date
        ) VALUES ($1, $2, $3, 'draft', 10000, 1800, 11800, '2026-05-15')`,
        [bizId, fyId, `ABANDONED-DRAFT-${i}`],
      );
    }

    // Saving a 33rd draft via Server Action must succeed (drafts are free)
    const saveRes = await saveInvoiceDraft({
      invoice_date: '2026-05-20',
      billing_name: 'Walk-in Customer',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Consulting Services',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    expect(saveRes.success).toBe(true);
    if (!saveRes.success) return;

    // Finalizing this invoice must succeed (0 finalized invoices exist this month)
    const finRes = await finalizeInvoice({ id: saveRes.data.invoiceId });
    expect(finRes.success).toBe(true);
    if (finRes.success) {
      expect(finRes.data.invoiceNumber).toBeDefined();
    }
  });

  it('AC-2: 30 finalized in month M blocks 31st with INVOICE_QUOTA_EXCEEDED without gaps; different month succeeds', async () => {
    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status, trial_ends_at
      ) VALUES (
        'Quota Test Biz', '27AAPFU0939F1ZY', '30 Link Rd', 'Mumbai', '27', '400050',
        'free', 'expired', NULL
      ) RETURNING id`,
    );
    const userId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-user-ac2', 'owner-ac2@test.dev', 'Owner AC2', 'owner') RETURNING id`,
      [bizId],
    );
    const fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [bizId],
    );
    const taxRateId = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 18%', '18.00', true, '2020-01-01') RETURNING id`,
    );

    state.businessId = bizId;
    state.userId = userId;

    // Insert 30 finalized invoices dated in 2026-06 (June 2026)
    for (let i = 1; i <= 30; i++) {
      await pg.query(
        `INSERT INTO invoices (
          business_id, financial_year_id, invoice_number, invoice_sequence, lifecycle_status,
          invoice_date, due_date, finalized_at, subtotal_paise, total_tax_paise, grand_total_paise,
          archival_status, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot,
          seller_snapshot_source, seller_gstin_snapshot
        ) VALUES (
          $1, $2, $3, $4, 'finalized',
          '2026-06-10', '2026-07-10', now(), 10000, 1800, 11800,
          'pending', 'Test Business', '{"city":"Mumbai"}'::jsonb, '27',
          'captured_at_finalization', '27AAPFU0939F1ZY'
        )`,
        [bizId, fyId, `INV-2026-06-${i}`, i],
      );
    }

    // Update sequence counter in financial_years so next sequence would be 31
    await pg.query(
      `UPDATE financial_years SET invoice_sequence_counter = 30 WHERE id = $1`,
      [fyId],
    );

    // Create a 31st draft invoice dated in June (2026-06-25)
    const juneDraftRes = await saveInvoiceDraft({
      invoice_date: '2026-06-25',
      billing_name: 'Customer June',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'June Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    expect(juneDraftRes.success).toBe(true);
    if (!juneDraftRes.success) return;
    const juneDraftId = juneDraftRes.data.invoiceId;

    // Finalizing the 31st June invoice must FAIL with INVOICE_QUOTA_EXCEEDED
    const finJuneRes = await finalizeInvoice({ id: juneDraftId });
    expect(finJuneRes.success).toBe(false);
    if (!finJuneRes.success) {
      expect(finJuneRes.error.code).toBe('INVOICE_QUOTA_EXCEEDED');
    }

    // Verify draft remains intact and sequence was NOT incremented (no gap)
    const checkDraft = await pg.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM invoices WHERE id = $1`,
      [juneDraftId],
    );
    expect(checkDraft.rows[0]?.lifecycle_status).toBe('draft');

    const checkCounter = await pg.query<{ invoice_sequence_counter: number }>(
      `SELECT invoice_sequence_counter FROM financial_years WHERE id = $1`,
      [fyId],
    );
    expect(checkCounter.rows[0]?.invoice_sequence_counter).toBe(30);

    // Finalizing an invoice dated in a DIFFERENT month (July 2026: 2026-07-05) must SUCCEED
    const julyDraftRes = await saveInvoiceDraft({
      invoice_date: '2026-07-05',
      billing_name: 'Customer July',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'July Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    expect(julyDraftRes.success).toBe(true);
    if (!julyDraftRes.success) return;

    const finJulyRes = await finalizeInvoice({ id: julyDraftRes.data.invoiceId });
    expect(finJulyRes.success).toBe(true);

    // Upgrading the business to 'essentials' / 'active' allows finalizing the 31st June invoice
    await pg.query(
      `UPDATE businesses SET subscription_plan = 'essentials', subscription_status = 'active' WHERE id = $1`,
      [bizId],
    );

    const finJuneRetry = await finalizeInvoice({ id: juneDraftId });
    expect(finJuneRetry.success).toBe(true);
  });

  it('AC-5: deleteInvoiceDraft deletes draft and lines; refused for finalized; cross-tenant NOT_FOUND; double-click safe', async () => {
    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Delete Draft Biz A', '27AAPFU0939F1ZZ', '40 Main St', 'Mumbai', '27', '400001',
        'free', 'expired'
      ) RETURNING id`,
    );
    const otherBizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Other Biz B', '27AAPFU0939F2ZA', '41 Main St', 'Mumbai', '27', '400001',
        'free', 'expired'
      ) RETURNING id`,
    );
    const userId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-user-ac5', 'owner-ac5@test.dev', 'Owner AC5', 'owner') RETURNING id`,
      [bizId],
    );
    const taxRateId = await insertOne(
      pg,
      `INSERT INTO tax_rates (label, rate_percentage, is_active, effective_from)
       VALUES ('GST 18%', '18.00', true, '2020-01-01') RETURNING id`,
    );

    state.businessId = bizId;
    state.userId = userId;

    // 1. Create draft with line items
    const draftRes = await saveInvoiceDraft({
      invoice_date: '2026-08-01',
      billing_name: 'Customer Delete',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Line To Delete',
          hsn_sac_code: '998311',
          quantity: 2,
          unit_of_measurement: 'NOS',
          unit_price: 500,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    expect(draftRes.success).toBe(true);
    if (!draftRes.success) return;
    const draftId = draftRes.data.invoiceId;

    // Verify lines exist
    const linesBefore = await pg.query<{ count: string | number }>(
      `SELECT count(*) FROM invoice_line_items WHERE invoice_id = $1`,
      [draftId],
    );
    expect(Number(linesBefore.rows[0]?.count)).toBe(1);

    // 2. Delete the draft
    const delRes = await deleteInvoiceDraft({ id: draftId });
    expect(delRes.success).toBe(true);

    // Verify invoice and lines are gone from DB
    const invAfter = await pg.query<{ id: string }>(`SELECT id FROM invoices WHERE id = $1`, [draftId]);
    expect(invAfter.rows).toHaveLength(0);

    const linesAfter = await pg.query<{ count: string | number }>(
      `SELECT count(*) FROM invoice_line_items WHERE invoice_id = $1`,
      [draftId],
    );
    expect(Number(linesAfter.rows[0]?.count)).toBe(0);

    // 3. Double-click simulation: calling deleteInvoiceDraft again on deleted draft returns NOT_FOUND
    const doubleClickRes = await deleteInvoiceDraft({ id: draftId });
    expect(doubleClickRes.success).toBe(false);
    if (!doubleClickRes.success) {
      expect(doubleClickRes.error.code).toBe('NOT_FOUND');
    }

    // 4. Finalized invoice: create finalized invoice and attempt to delete it -> ALREADY_FINALIZED
    const finDraftRes = await saveInvoiceDraft({
      invoice_date: '2026-08-05',
      billing_name: 'Customer Finalized',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Permanent Record Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 1000,
          discount: 0,
          tax_rate_id: taxRateId,
        },
      ],
    });
    if (!finDraftRes.success) return;
    const finalizedInvId = finDraftRes.data.invoiceId;
    await finalizeInvoice({ id: finalizedInvId });

    const delFinRes = await deleteInvoiceDraft({ id: finalizedInvId });
    expect(delFinRes.success).toBe(false);
    if (!delFinRes.success) {
      expect(delFinRes.error.code).toBe('ALREADY_FINALIZED');
      expect(delFinRes.error.message).toContain('Finalized invoices cannot be deleted under GST law');
    }

    // 5. Cross-tenant draft: create a draft for otherBizId, attempt to delete while authenticated as bizId -> NOT_FOUND
    const otherFyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31') RETURNING id`,
      [otherBizId],
    );
    const otherDraftId = await insertOne(
      pg,
      `INSERT INTO invoices (
        business_id, financial_year_id, invoice_number, lifecycle_status, subtotal_paise, total_tax_paise, grand_total_paise
      ) VALUES ($1, $2, 'OTHER-DRAFT-1', 'draft', 1000, 180, 1180) RETURNING id`,
      [otherBizId, otherFyId],
    );

    const crossTenantRes = await deleteInvoiceDraft({ id: otherDraftId });
    expect(crossTenantRes.success).toBe(false);
    if (!crossTenantRes.success) {
      expect(crossTenantRes.error.code).toBe('NOT_FOUND');
    }
  });

  it('AC-4: Suspended business is blocked from mutating actions with ACCOUNT_SUSPENDED; exempt actions still run', async () => {
    const bizId = await insertOne(
      pg,
      `INSERT INTO businesses (
        legal_name, gstin, address_line1, city, state_code, pincode,
        subscription_plan, subscription_status
      ) VALUES (
        'Suspended Biz', '27AAPFU0939F2ZB', '50 Central Ave', 'Mumbai', '27', '400001',
        'essentials', 'suspended'
      ) RETURNING id`,
    );
    const userId = await insertOne(
      pg,
      `INSERT INTO users (business_id, auth_user_id, email, display_name, role)
       VALUES ($1, 'auth-user-ac4', 'owner-ac4@test.dev', 'Owner AC4', 'owner') RETURNING id`,
      [bizId],
    );

    state.businessId = bizId;
    state.userId = userId;

    // Mutating actions: createCustomer blocked
    const custRes = await createCustomer({
      name: 'Blocked Customer',
      state_code: '27',
      city: 'Mumbai',
    });
    expect(custRes.success).toBe(false);
    if (!custRes.success) {
      expect(custRes.error.code).toBe('ACCOUNT_SUSPENDED');
    }

    // recordPayment blocked
    const payRes = await recordPayment({
      invoice_id: '00000000-0000-4000-8000-000000000001',
      amount: 100,
      payment_method: 'upi',
      payment_date: '2026-09-01',
    });
    expect(payRes.success).toBe(false);
    if (!payRes.success) {
      expect(payRes.error.code).toBe('ACCOUNT_SUSPENDED');
    }

    // saveInvoiceDraft blocked
    const draftRes = await saveInvoiceDraft({
      invoice_date: '2026-09-01',
      billing_name: 'Blocked Inv',
      place_of_supply_state_code: '27',
      invoice_template: 'template_1',
      line_items: [
        {
          description: 'Blocked Item',
          hsn_sac_code: '998311',
          quantity: 1,
          unit_of_measurement: 'NOS',
          unit_price: 100,
          discount: 0,
          tax_rate_id: '00000000-0000-4000-8000-000000000001',
        },
      ],
    });
    expect(draftRes.success).toBe(false);
    if (!draftRes.success) {
      expect(draftRes.error.code).toBe('ACCOUNT_SUSPENDED');
    }

    // Exempt action: submitPaymentClaim (path back to active) must NOT be blocked with ACCOUNT_SUSPENDED
    const claimRes = await submitPaymentClaim({
      plan: 'essentials',
      billing_cycle: 'yearly',
      utr_number: '123456789012',
    });
    // Even if it fails validation or DB state, it MUST NOT fail with ACCOUNT_SUSPENDED!
    if (!claimRes.success) {
      expect(claimRes.error.code).not.toBe('ACCOUNT_SUSPENDED');
    }
  });
}, 60_000);
