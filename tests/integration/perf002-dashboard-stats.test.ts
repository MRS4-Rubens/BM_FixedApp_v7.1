import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import type { ActionResult } from '@/lib/actions/_shared/types';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  businessId: '',
  userId: '00000000-0000-4000-8000-000000000001',
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
    role: 'owner',
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined }));

import { getDashboardStats } from '@/lib/actions/reports/get-dashboard-stats';

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error.message} (${result.error.code})`);
  }
  return result.data;
}

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
}

function readJournal(): JournalEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
  const entries = (raw as { entries: Array<{ tag: string }> }).entries;
  return entries.map((e) => ({ tag: e.tag }));
}

async function applyMigrations(pg: PGlite): Promise<void> {
  const entries = readJournal();
  for (const entry of entries) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

let invoiceSeq = 1;
let cnSeq = 1;

async function insertInvoice(
  pg: PGlite,
  data: {
    businessId: string;
    financialYearId: string;
    invoiceNumber: string;
    lifecycleStatus?: 'draft' | 'finalized';
    paymentStatus?: 'unpaid' | 'partially_paid' | 'paid' | 'overdue';
    invoiceDate?: string;
    dueDate?: string | null;
    grandTotalPaise: number;
  },
): Promise<string> {
  const isFinalized = (data.lifecycleStatus ?? 'finalized') === 'finalized';
  const seq = isFinalized ? invoiceSeq++ : null;
  const res = await pg.query<{ id: string }>(
    `INSERT INTO invoices (
       business_id, financial_year_id, invoice_number, invoice_sequence,
       lifecycle_status, payment_status, invoice_date, due_date, grand_total_paise,
       subtotal_paise, total_tax_paise,
       finalized_at, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)
     RETURNING id;`,
    [
      data.businessId,
      data.financialYearId,
      data.invoiceNumber,
      seq,
      data.lifecycleStatus ?? 'finalized',
      data.paymentStatus ?? 'unpaid',
      data.invoiceDate ?? '2026-11-01',
      data.dueDate ?? null,
      data.grandTotalPaise,
      data.grandTotalPaise,
      isFinalized ? new Date() : null,
      isFinalized ? 'Tenant Legal Name' : null,
      isFinalized ? JSON.stringify({ line1: '100 Road', city: 'Bengaluru', pincode: '560001' }) : null,
      isFinalized ? '29' : null,
      isFinalized ? 'captured_at_finalization' : null,
    ],
  );
  return res.rows[0].id;
}

async function insertPayment(
  pg: PGlite,
  data: {
    businessId: string;
    invoiceId: string;
    amountPaise: number;
    status?: 'active' | 'voided';
    paymentDate?: string;
  },
): Promise<string> {
  const isVoided = (data.status ?? 'active') === 'voided';
  const res = await pg.query<{ id: string }>(
    `INSERT INTO payments (
       business_id, invoice_id, amount_paise, payment_date, payment_method,
       status, voided_at, void_reason
     )
     VALUES ($1, $2, $3, $4, 'bank_transfer', $5, $6, $7)
     RETURNING id;`,
    [
      data.businessId,
      data.invoiceId,
      data.amountPaise,
      data.paymentDate ?? '2026-11-02',
      data.status ?? 'active',
      isVoided ? new Date() : null,
      isVoided ? 'Mistake' : null,
    ],
  );
  return res.rows[0].id;
}

async function insertCreditNote(
  pg: PGlite,
  data: {
    businessId: string;
    originalInvoiceId: string;
    financialYearId: string;
    creditNoteNumber: string;
    lifecycleStatus?: 'draft' | 'finalized';
    status?: 'active' | 'voided';
    grandTotalPaise: number;
    issueDate?: string;
  },
): Promise<string> {
  const isFinalized = (data.lifecycleStatus ?? 'finalized') === 'finalized';
  const isVoided = (data.status ?? 'active') === 'voided';
  const seq = isFinalized ? cnSeq++ : null;
  const res = await pg.query<{ id: string }>(
    `INSERT INTO credit_notes (
       business_id, original_invoice_id, financial_year_id, credit_note_number, credit_note_sequence,
       reason, lifecycle_status, status, issue_date, grand_total_paise, subtotal_paise, total_tax_paise,
       finalized_at, voided_at, void_reason,
       seller_gstin_snapshot, seller_name_snapshot, seller_address_snapshot,
       seller_state_code_snapshot, seller_snapshot_source
     )
     VALUES ($1, $2, $3, $4, $5, '01-sales-return', $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING id;`,
    [
      data.businessId,
      data.originalInvoiceId,
      data.financialYearId,
      data.creditNoteNumber,
      seq,
      data.lifecycleStatus ?? 'finalized',
      data.status ?? 'active',
      isFinalized ? (data.issueDate ?? '2026-11-03') : null,
      data.grandTotalPaise,
      data.grandTotalPaise,
      isFinalized ? new Date() : null,
      isVoided ? new Date() : null,
      isVoided ? 'Mistake' : null,
      isFinalized ? '29ABCDE1234F1Z5' : null,
      isFinalized ? 'Tenant Legal Name' : null,
      isFinalized ? JSON.stringify({ line1: '100 Road', city: 'Bengaluru', pincode: '560001' }) : null,
      isFinalized ? '29' : null,
      isFinalized ? 'captured_at_finalization' : null,
    ],
  );
  return res.rows[0].id;
}

describe('PERF-002: Dashboard Outstanding and Overdue Integration Tests', () => {
  let pg: PGlite;
  let businessAId: string;
  let businessBId: string;
  let fyAId: string;
  let fyBId: string;

  beforeAll(async () => {
    // Pin "today" (Date only, not timers) so the fixtures' due dates (past 2026-10-15, future 2026-11-30) stay
    // past/future regardless of when the suite runs. 06:30Z = 12:00 IST on 8 Nov 2026.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T06:30:00.000Z'));
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });

    // 1. Seed Business A
    const resA = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant A Corp', '29ABCDE1234F1Z5', '100 A St', 'Bengaluru', '29', '560001')
       RETURNING id;`,
    );
    businessAId = resA.rows[0].id;

    const resFyA = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-2027', '2026-04-01', '2027-03-31')
       RETURNING id;`,
      [businessAId],
    );
    fyAId = resFyA.rows[0].id;

    // 2. Seed Business B
    const resB = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant B Corp', '27ABCDE1234F1Z6', '200 B St', 'Mumbai', '27', '400001')
       RETURNING id;`,
    );
    businessBId = resB.rows[0].id;

    const resFyB = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-2027', '2026-04-01', '2027-03-31')
       RETURNING id;`,
      [businessBId],
    );
    fyBId = resFyB.rows[0].id;

    // 3. Seed Fixtures for Business A:
    // (a) Unpaid not due: 100,000 paise, due_date in future ('2026-11-30') -> outstanding: 100,000, not overdue
    await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-001',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      dueDate: '2026-11-30',
      grandTotalPaise: 100000,
    });

    // (b) Unpaid overdue by date: 200,000 paise, due_date in past ('2026-10-15') -> outstanding: 200,000, overdue
    await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-002',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      dueDate: '2026-10-15',
      grandTotalPaise: 200000,
    });

    // (c) Payment status 'overdue': 150,000 paise, due_date in future or null -> outstanding: 150,000, overdue
    await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-003',
      lifecycleStatus: 'finalized',
      paymentStatus: 'overdue',
      dueDate: '2026-11-30',
      grandTotalPaise: 150000,
    });

    // (d) Partially paid: 300,000 paise, 1 active payment (100,000), 1 voided payment (50,000)
    // -> remaining: 300,000 - 100,000 = 200,000, due in future -> outstanding: 200,000, not overdue
    const inv4 = await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-004',
      lifecycleStatus: 'finalized',
      paymentStatus: 'partially_paid',
      dueDate: '2026-11-30',
      grandTotalPaise: 300000,
    });
    await insertPayment(pg, {
      businessId: businessAId,
      invoiceId: inv4,
      amountPaise: 100000,
      status: 'active',
    });
    await insertPayment(pg, {
      businessId: businessAId,
      invoiceId: inv4,
      amountPaise: 50000,
      status: 'voided',
    });

    // (e1) One with an ACTIVE FINALIZED credit note: 400,000 paise, CN 150,000 -> remaining: 250,000, not overdue
    const inv5a = await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-005A',
      lifecycleStatus: 'finalized',
      paymentStatus: 'partially_paid',
      dueDate: '2026-11-30',
      grandTotalPaise: 400000,
    });
    await insertCreditNote(pg, {
      businessId: businessAId,
      originalInvoiceId: inv5a,
      financialYearId: fyAId,
      creditNoteNumber: 'CN-A-001',
      lifecycleStatus: 'finalized',
      status: 'active',
      grandTotalPaise: 150000,
    });

    // (e2) One with a VOIDED credit note: 250,000 paise, CN 100,000 voided -> remaining: 250,000 (CN not applied), not overdue
    const inv5b = await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-005B',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      dueDate: '2026-11-30',
      grandTotalPaise: 250000,
    });
    await insertCreditNote(pg, {
      businessId: businessAId,
      originalInvoiceId: inv5b,
      financialYearId: fyAId,
      creditNoteNumber: 'CN-A-002',
      lifecycleStatus: 'finalized',
      status: 'voided',
      grandTotalPaise: 100000,
    });

    // (e3) One with a DRAFT credit note: 180,000 paise, CN 80,000 draft -> remaining: 180,000 (CN not applied), not overdue
    const inv5c = await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-005C',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      dueDate: '2026-11-30',
      grandTotalPaise: 180000,
    });
    await insertCreditNote(pg, {
      businessId: businessAId,
      originalInvoiceId: inv5c,
      financialYearId: fyAId,
      creditNoteNumber: 'CN-A-003',
      lifecycleStatus: 'draft',
      status: 'active',
      grandTotalPaise: 80000,
    });

    // (f) Fully covered by payment + credit note: 100,000 total, 60,000 paid, 40,000 credited
    // -> remaining: 0 (must be excluded from outstanding and overdue, even with past due date)
    const inv6 = await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-006',
      lifecycleStatus: 'finalized',
      paymentStatus: 'partially_paid',
      dueDate: '2026-10-10',
      grandTotalPaise: 100000,
    });
    await insertPayment(pg, {
      businessId: businessAId,
      invoiceId: inv6,
      amountPaise: 60000,
      status: 'active',
    });
    await insertCreditNote(pg, {
      businessId: businessAId,
      originalInvoiceId: inv6,
      financialYearId: fyAId,
      creditNoteNumber: 'CN-A-004',
      lifecycleStatus: 'finalized',
      status: 'active',
      grandTotalPaise: 40000,
    });

    // (g) A paid invoice: 500,000 paise -> excluded by payment_status IN ('unpaid', 'partially_paid', 'overdue')
    await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-007',
      lifecycleStatus: 'finalized',
      paymentStatus: 'paid',
      dueDate: '2026-10-10',
      grandTotalPaise: 500000,
    });

    // (h) A draft invoice: 350,000 paise -> excluded by lifecycle_status = 'finalized'
    await insertInvoice(pg, {
      businessId: businessAId,
      financialYearId: fyAId,
      invoiceNumber: 'INV-A-008',
      lifecycleStatus: 'draft',
      paymentStatus: 'unpaid',
      dueDate: '2026-10-10',
      grandTotalPaise: 350000,
    });

    // 4. Seed Business B (must NEVER bleed into Business A stats):
    // Unpaid, overdue invoice for B: 999,999 paise with active payment & credit note
    const invB = await insertInvoice(pg, {
      businessId: businessBId,
      financialYearId: fyBId,
      invoiceNumber: 'INV-B-001',
      lifecycleStatus: 'finalized',
      paymentStatus: 'overdue',
      dueDate: '2026-10-01',
      grandTotalPaise: 999999,
    });
    await insertPayment(pg, {
      businessId: businessBId,
      invoiceId: invB,
      amountPaise: 111111,
      status: 'active',
    });
    await insertCreditNote(pg, {
      businessId: businessBId,
      originalInvoiceId: invB,
      financialYearId: fyBId,
      creditNoteNumber: 'CN-B-001',
      lifecycleStatus: 'finalized',
      status: 'active',
      grandTotalPaise: 222222,
    });
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await pg.close();
  });

  it('computes exact outstanding and overdue stats for Business A and isolates Business B', async () => {
    state.businessId = businessAId;
    const res = await getDashboardStats({});
    const stats = expectSuccess(res);

    // Hand-calculated expected figures for Business A:
    // (a) INV-A-001: 100,000 (not overdue)
    // (b) INV-A-002: 200,000 (overdue by past due_date 2026-10-15)
    // (c) INV-A-003: 150,000 (overdue by payment_status 'overdue')
    // (d) INV-A-004: 300,000 - 100,000 = 200,000 (not overdue)
    // (e1) INV-A-005A: 400,000 - 150,000 = 250,000 (not overdue)
    // (e2) INV-A-005B: 250,000 (voided CN ignored, not overdue)
    // (e3) INV-A-005C: 180,000 (draft CN ignored, not overdue)
    // (f) INV-A-006: 100,000 - 60,000 - 40,000 = 0 (excluded)
    // (g) INV-A-007: paid (excluded)
    // (h) INV-A-008: draft (excluded)
    // Business B: all 999,999 excluded
    //
    // Expected outstanding = 100k + 200k + 150k + 200k + 250k + 250k + 180k = 1,330,000 paise
    // Expected overdueCount = 2 (INV-A-002 and INV-A-003)
    // Expected overdueAmount = 200k + 150k = 350,000 paise

    expect(stats.outstandingAmountPaise).toBe(1330000);
    expect(stats.outstandingTotalPaise).toBe(1330000);
    expect(stats.overdueCount).toBe(2);
    expect(stats.overdueAmountPaise).toBe(350000);
    expect(stats.overdueTotalPaise).toBe(350000);
  });

  it('verifies EXPLAIN query plan contains no SubPlan', async () => {
    const explainRes = await pg.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT
         coalesce(sum(t.remaining), 0)::bigint AS outstanding,
         count(*) filter (where t.is_overdue)::int AS overdue_count,
         coalesce(sum(t.remaining) filter (where t.is_overdue), 0)::bigint AS overdue_amount
       FROM (
         SELECT
           greatest(0, i.grand_total_paise - coalesce(p.paid, 0) - coalesce(c.credited, 0)) AS remaining,
           (i.payment_status = 'overdue' OR (i.due_date IS NOT NULL AND i.due_date < $1::date)) AS is_overdue
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, sum(amount_paise) AS paid
           FROM payments
           WHERE business_id = $2
             AND status = 'active'
           GROUP BY invoice_id
         ) p ON p.invoice_id = i.id
         LEFT JOIN (
           SELECT original_invoice_id, sum(grand_total_paise) AS credited
           FROM credit_notes
           WHERE business_id = $2
             AND lifecycle_status = 'finalized'
             AND status = 'active'
           GROUP BY original_invoice_id
         ) c ON c.original_invoice_id = i.id
         WHERE i.business_id = $2
           AND i.lifecycle_status = 'finalized'
           AND i.payment_status IN ('unpaid', 'partially_paid', 'overdue')
       ) t
       WHERE t.remaining > 0`,
      ['2026-11-07', businessAId],
    );

    const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(planText).not.toContain('SubPlan');
  });
});
