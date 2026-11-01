import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import { writeAudit, NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: '00000000-0000-0000-0000-000000000001',
  businessId: '',
  headers: new Map<string, string>(),
}));

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: state.userId,
    business_id: state.businessId,
    email: 'user@test.dev',
    display_name: 'Test Actor',
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => state.headers.get(name.toLowerCase()) ?? null,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));
vi.mock('@/lib/storage/archive-invoice', () => ({ archiveInvoicePdf: async () => ({ success: true }) }));
vi.mock('@/lib/storage/archive-credit-note', () => ({ archiveCreditNotePdf: async () => ({ success: true }) }));
vi.mock('@/lib/auth/admin', () => ({
  requirePlatformAdmin: async () => ({ email: 'admin@test.dev' }),
}));

import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';
import { recordPayment } from '@/lib/actions/payments/record-payment';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { processSubscriptionClaim } from '@/lib/actions/subscriptions/process-request';
import { updateBusinessSubscription } from '@/lib/actions/subscriptions/update-business-subscription';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

async function applyMigrations(pg: PGlite, entries: JournalEntry[]): Promise<void> {
  for (const entry of entries) {
    const rawSql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
    const statements = rawSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

interface IdRow {
  id: string;
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<IdRow>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

describe('DB-007: Audit log integrity, append-only triggers, and coverage', () => {
  let pg: PGlite;
  let businessId: string;
  let actorUserId: string;
  let financialYearId: string;
  let customerId: string;
  let invId: string;

  beforeAll(async () => {
    pg = new PGlite();
    state.db = drizzle(pg, { schema });
    await applyMigrations(pg, readJournal());

    businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, trade_name, gstin, pan, address_line1, city, state_code, pincode, phone, email, subscription_plan, subscription_status)
       VALUES ('Audit Test Corp', 'Audit Corp', '29ABCDE1234F1Z5', 'ABCDE1234F', '123 Test St', 'Bengaluru', '29', '560001', '9876543210', 'audit@test.dev', 'essentials', 'active') RETURNING id`,
    );
    state.businessId = businessId;

    actorUserId = await insertOne(
      pg,
      `INSERT INTO users (id, auth_user_id, business_id, email, display_name, role)
       VALUES ('00000000-0000-0000-0000-000000000001', 'auth_actor_1', $1, 'actor@test.dev', 'Test Actor', 'owner') RETURNING id`,
      [businessId],
    );
    state.userId = actorUserId;

    financialYearId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [businessId],
    );

    customerId = await insertOne(
      pg,
      `INSERT INTO customers (business_id, name, email, state_code)
       VALUES ($1, 'Customer One', 'c1@test.dev', '29') RETURNING id`,
      [businessId],
    );
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  it('1. Schema / trigger metadata: ip and user_agent columns exist, both guard triggers ENABLE ALWAYS', async () => {
    const colRes = await pg.query<{ column_name: string; data_type: string; character_maximum_length: number }>(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'audit_log' AND column_name IN ('ip', 'user_agent')
      ORDER BY column_name;
    `);

    expect(colRes.rows).toHaveLength(2);
    expect(colRes.rows[0]).toEqual({
      column_name: 'ip',
      data_type: 'character varying',
      character_maximum_length: 45,
    });
    expect(colRes.rows[1]).toEqual({
      column_name: 'user_agent',
      data_type: 'character varying',
      character_maximum_length: 512,
    });

    const trigRes = await pg.query<{ tgname: string; tgenabled: string }>(`
      SELECT tgname, tgenabled
      FROM pg_trigger
      WHERE tgname IN ('bm_audit_log_guard', 'bm_audit_log_guard_truncate')
      ORDER BY tgname;
    `);

    expect(trigRes.rows).toHaveLength(2);
    // 'A' = ENABLE ALWAYS
    expect(trigRes.rows[0].tgenabled).toBe('A');
    expect(trigRes.rows[1].tgenabled).toBe('A');
  });

  it('2. Append-only enforcement: INSERT succeeds; UPDATE, DELETE, TRUNCATE fail with BM_AUDIT_APPEND_ONLY (even in replica mode)', async () => {
    const rowId = await insertOne(
      pg,
      `INSERT INTO audit_log (business_id, user_id, entity_type, entity_id, action, metadata, ip, user_agent)
       VALUES ($1, $2, 'business', $1, 'profile_create', '{"test":true}'::jsonb, '127.0.0.1', 'Vitest') RETURNING id`,
      [businessId, actorUserId],
    );

    // UPDATE fails
    await expect(
      pg.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [rowId]),
    ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);

    // DELETE fails
    await expect(
      pg.query(`DELETE FROM audit_log WHERE id = $1`, [rowId]),
    ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);

    // TRUNCATE fails
    await expect(
      pg.query(`TRUNCATE audit_log`),
    ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);

    // Set replica mode -> triggers must still fire because of ENABLE ALWAYS!
    await pg.exec(`SET session_replication_role = replica;`);
    try {
      await expect(
        pg.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [rowId]),
      ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);

      await expect(
        pg.query(`DELETE FROM audit_log WHERE id = $1`, [rowId]),
      ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);

      await expect(
        pg.query(`TRUNCATE audit_log`),
      ).rejects.toThrow(/BM_AUDIT_APPEND_ONLY/);
    } finally {
      await pg.exec(`SET session_replication_role = DEFAULT;`);
    }
  });

  it('3. Foreign key policy: hard deleting user or business with audit rows fails with 23503', async () => {
    // Delete actor user fails with 23503 (integrity_constraint_violation)
    await expect(
      pg.query(`DELETE FROM users WHERE id = $1`, [actorUserId]),
    ).rejects.toThrow(/violates foreign key constraint/);

    // Delete business fails with 23503
    await expect(
      pg.query(`DELETE FROM businesses WHERE id = $1`, [businessId]),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('4. ip and user_agent bounds: column rejects 46-char ip; writeAudit sanitizes without failing', async () => {
    const longIp = '2001:0db8:85a3:0000:0000:8a2e:0370:7334:extra-chars'; // > 45 chars
    await expect(
      pg.query(
        `INSERT INTO audit_log (business_id, user_id, entity_type, entity_id, action, ip)
         VALUES ($1, $2, 'business', $1, 'profile_create', $3)`,
        [businessId, actorUserId, longIp],
      ),
    ).rejects.toThrow(/value too long for type character varying\(45\)/);

    // writeAudit sanitizes rather than throwing:
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        businessId,
        actorUserId,
        entityType: 'business',
        entityId: businessId,
        action: 'profile_update',
        requestContext: { ip: longIp, userAgent: 'A'.repeat(600) },
        metadata: { field: 'value' },
      });
    });

    const latest = await pg.query<{ ip: string | null; user_agent: string | null }>(
      `SELECT ip, user_agent FROM audit_log WHERE action = 'profile_update' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(latest.rows[0].ip).toBeNull(); // sanitized
    expect(latest.rows[0].user_agent).toHaveLength(512); // truncated
  });

  it('5. Executed action coverage: actions write structured audit rows with request context', async () => {
    state.headers.set('x-forwarded-for', '203.0.113.50');
    state.headers.set('user-agent', 'TestBrowser/1.0 (Integration)');

    // 5a. finalizeInvoice
    invId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date)
       VALUES ($1, $2, 'DRAFT-AUDIT-1', $3, 'draft', '29', 10000, 1800, 11800, '2026-04-15', '2026-05-15') RETURNING id`,
      [businessId, financialYearId, customerId],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise)
       VALUES ($1, 'Item 1', '8471', 1.000, 'NOS', 10000, 0, 10000, '18.00', 11800, 900, 900)`,
      [invId],
    );

    const finRes = await finalizeInvoice({ id: invId });
    expect(finRes.success).toBe(true);

    const invAudit = await pg.query<{ entity_type: string; action: string; ip: string; user_agent: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, ip, user_agent, metadata FROM audit_log WHERE entity_id = $1 AND action = 'finalize'`,
      [invId],
    );
    expect(invAudit.rows).toHaveLength(1);
    expect(invAudit.rows[0].entity_type).toBe('invoice');
    expect(invAudit.rows[0].ip).toBe('203.0.113.50');
    expect(invAudit.rows[0].user_agent).toBe('TestBrowser/1.0 (Integration)');
    expect(invAudit.rows[0].metadata.grand_total_paise).toBe(11800);

    // 5b. recordPayment
    const payRes = await recordPayment({
      invoice_id: invId,
      amount: 50,
      payment_date: '2026-04-15',
      payment_method: 'bank_transfer',
      reference_number: 'UTR-AUDIT-1',
    });
    expect(payRes.success).toBe(true);

    const payAudit = await pg.query<{ entity_type: string; action: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, metadata FROM audit_log WHERE entity_type = 'payment' AND action = 'record' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(payAudit.rows).toHaveLength(1);
    expect(payAudit.rows[0].metadata.amount_paise).toBe(5000);
    expect(payAudit.rows[0].metadata.invoice_id).toBe(invId);

    // 5c. finalizeCreditNote
    const cnId = await insertOne(
      pg,
      `INSERT INTO credit_notes (business_id, original_invoice_id, financial_year_id, credit_note_number, reason,
         lifecycle_status, status, issue_date, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, $3, 'CN-DRAFT-AUDIT', '01-sales-return', 'draft', 'active', '2026-04-15', 5000, 450, 450, 0, 900, 5900) RETURNING id`,
      [businessId, invId, financialYearId],
    );
    const origLine = await pg.query<IdRow>(`SELECT id FROM invoice_line_items WHERE invoice_id = $1 LIMIT 1`, [invId]);
    await pg.query(
      `INSERT INTO credit_note_line_items (credit_note_id, original_line_item_id, description, hsn_sac_code, quantity,
         unit_of_measurement, unit_price_paise, discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise, igst_paise)
       VALUES ($1, $2, 'CN Line', '8471', 0.500, 'NOS', 10000, 0, 5000, '18.00', 5900, 450, 450, 0)`,
      [cnId, origLine.rows[0].id],
    );

    const cnFinalRes = await finalizeCreditNote({ id: cnId });
    expect(cnFinalRes.success).toBe(true);

    const cnAudit = await pg.query<{ entity_type: string; action: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, metadata FROM audit_log WHERE entity_id = $1 AND action = 'finalize'`,
      [cnId],
    );
    expect(cnAudit.rows).toHaveLength(1);
    expect(cnAudit.rows[0].metadata.original_invoice_id).toBe(invId);

    // 5d. saveBusinessProfile edit with GSTIN and bank account change
    const profRes = await saveBusinessProfile({
      legal_name: 'Audit Test Corp Updated',
      trade_name: 'Audit Corp',
      gstin: '29ABCDE9999F1Z9',
      registration_type: 'regular',
      address_line1: '999 New Street',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      bank_account_name: 'Audit Corp Account',
      bank_account_number: '98765432109999',
      bank_ifsc: 'HDFC0000123',
      bank_name: 'HDFC Bank',
    });
    expect(profRes.success).toBe(true);

    const profAudit = await pg.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log WHERE entity_type = 'business' AND action = 'profile_update' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(profAudit.rows).toHaveLength(1);
    const serialized = JSON.stringify(profAudit.rows[0].metadata);
    expect(serialized).not.toContain('98765432109999'); // Full bank account never persisted
    expect(profAudit.rows[0].metadata.changes).toHaveProperty('bank_account_last4');

    // 5e. No-op profile edit writes NO audit row
    const countBefore = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM audit_log WHERE action = 'profile_update'`);
    const noopRes = await saveBusinessProfile({
      legal_name: 'Audit Test Corp Updated',
      trade_name: 'Audit Corp',
      gstin: '29ABCDE9999F1Z9',
      registration_type: 'regular',
      address_line1: '999 New Street',
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      bank_account_name: 'Audit Corp Account',
      bank_account_number: '98765432109999',
      bank_ifsc: 'HDFC0000123',
      bank_name: 'HDFC Bank',
    });
    expect(noopRes.success).toBe(true);
    const countAfter = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM audit_log WHERE action = 'profile_update'`);
    expect(countAfter.rows[0].c).toBe(countBefore.rows[0].c);

    // 5f. processSubscriptionClaim approve and reject
    const claim1Id = await insertOne(
      pg,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'essentials', 'yearly', 1200000, 'upi_id', 'UTR-REQ-1', 'pending') RETURNING id`,
      [businessId, actorUserId],
    );

    const rejRes = await processSubscriptionClaim({
      request_id: claim1Id,
      action: 'reject',
      reject_reason: 'Invalid UTR',
    });
    expect(rejRes.success).toBe(true);

    const rejAudit = await pg.query<{ entity_type: string; action: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, metadata FROM audit_log WHERE entity_id = $1 AND action = 'reject'`,
      [claim1Id],
    );
    expect(rejAudit.rows).toHaveLength(1);
    expect(rejAudit.rows[0].metadata.reject_reason).toBe('Invalid UTR');

    const claim2Id = await insertOne(
      pg,
      `INSERT INTO subscription_requests (business_id, user_id, plan_name, billing_cycle, amount_paise, payment_method, payment_reference, status)
       VALUES ($1, $2, 'professional', 'monthly', 150000, 'upi_id', 'UTR-REQ-2', 'pending') RETURNING id`,
      [businessId, actorUserId],
    );

    const appRes = await processSubscriptionClaim({
      request_id: claim2Id,
      action: 'approve',
    });
    expect(appRes.success).toBe(true);

    const appAudit = await pg.query<{ entity_type: string; action: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, metadata FROM audit_log WHERE entity_id = $1 AND action = 'approve'`,
      [claim2Id],
    );
    expect(appAudit.rows).toHaveLength(1);
    expect(appAudit.rows[0].metadata.plan_name).toBe('professional');

    // 5g. updateBusinessSubscription
    const overrideRes = await updateBusinessSubscription({
      business_id: businessId,
      subscription_plan: 'professional',
      subscription_status: 'active',
      subscription_ends_at: new Date('2027-12-31').toISOString(),
    });
    expect(overrideRes.success).toBe(true);

    const overrideAudit = await pg.query<{ entity_type: string; action: string; metadata: Record<string, unknown> }>(
      `SELECT entity_type, action, metadata FROM audit_log WHERE entity_type = 'business' AND action = 'subscription_manual_override' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(overrideAudit.rows).toHaveLength(1);
    expect(overrideAudit.rows[0].metadata).toHaveProperty('updated_by');
    expect(overrideAudit.rows[0].metadata).toHaveProperty('previous');
  });

  it('6. Atomicity: "No audit, no action" — non-existent actor user id rolls back business action completely', async () => {
    // Set actor to a nonexistent user id
    state.userId = '00000000-0000-0000-0000-999999999999';

    // 6a. recordPayment fails and rolls back payment and invoice payment_status
    // Record payment against invId (which has remaining balance)
    const paymentsBefore = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM payments WHERE invoice_id = $1`, [invId]);

    const payRes = await recordPayment({
      invoice_id: invId,
      amount: 5,
      payment_date: '2026-04-15',
      payment_method: 'bank_transfer',
    });

    expect(payRes.success).toBe(false);

    // Payments row count unchanged (rolled back)
    const paymentsAfter = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM payments WHERE invoice_id = $1`, [invId]);
    expect(paymentsAfter.rows[0].c).toBe(paymentsBefore.rows[0].c);

    // 6b. finalizeInvoice fails and invoice stays draft
    const draftId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, customer_id, lifecycle_status,
         place_of_supply_state_code, subtotal_paise, total_tax_paise, grand_total_paise, invoice_date, due_date)
       VALUES ($1, $2, 'DRAFT-ROLLBACK-1', $3, 'draft', '29', 10000, 1800, 11800, '2026-04-15', '2026-05-15') RETURNING id`,
      [businessId, financialYearId, customerId],
    );
    await pg.query(
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         discount_paise, taxable_value_paise, tax_rate_percentage, line_total_paise, cgst_paise, sgst_paise)
       VALUES ($1, 'Item R', '8471', 1.000, 'NOS', 10000, 0, 10000, '18.00', 11800, 900, 900)`,
      [draftId],
    );

    const finRes = await finalizeInvoice({ id: draftId });
    expect(finRes.success).toBe(false);

    // Invoice status remains draft
    const draftRow = await pg.query<{ lifecycle_status: string }>(`SELECT lifecycle_status FROM invoices WHERE id = $1`, [draftId]);
    expect(draftRow.rows[0].lifecycle_status).toBe('draft');

    // Restore valid user id
    state.userId = actorUserId;
  });

  it('7. Retry safety: audit row rolls back atomically with failed transaction', async () => {
    const auditCountBefore = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM audit_log`);

    await expect(
      db.transaction(async (tx) => {
        await writeAudit(tx, {
          businessId,
          actorUserId,
          entityType: 'business',
          entityId: businessId,
          action: 'profile_update',
          requestContext: NO_AUDIT_REQUEST_CONTEXT,
          metadata: { attempt: 1 },
        });
        throw new Error('Simulated failure after audit write');
      }),
    ).rejects.toThrow(/Simulated failure after audit write/);

    const auditCountAfter = await pg.query<{ c: number }>(`SELECT count(*)::int as c FROM audit_log`);
    expect(auditCountAfter.rows[0].c).toBe(auditCountBefore.rows[0].c);
  });
});
