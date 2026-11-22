// REFUND: end-to-end money rules against a real (PGlite) Postgres with all migrations applied.
// One invoice walks through: paid in full -> credit note -> refund due -> refunds (partial, over, early, full)
// -> refund voided -> protected voids of payment and credit note -> append-only payment rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/_shared/types';
import * as schema from '@/lib/db/schema';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';

const state = vi.hoisted(() => ({ db: undefined as unknown, businessId: '' }));
const USER_ID = '00000000-0000-4000-8000-0000000000b1';

vi.mock('@/lib/db/client', () => ({
  get db() {
    return state.db;
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getCurrentAppUser: async () => ({
    id: '00000000-0000-4000-8000-0000000000b1',
    business_id: state.businessId,
    role: 'owner' as const,
    display_name: 'Owner',
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
// BUG-05: a test makes revalidation fail AFTER a committed payment; normally it does nothing.
const revalidatePathMock = vi.hoisted(() => vi.fn<(path: string) => void>());
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));
vi.mock('@/lib/rate-limit/upstash', () => ({
  sensitiveActionLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: () => undefined, logWarn: () => undefined }));
vi.mock('next/server', () => ({ after: () => undefined }));

import { finalizeDraftInvoiceInTransaction } from '@/lib/invoices/finalize-invoice-tx';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';
import { voidCreditNote } from '@/lib/actions/credit-notes/void-credit-note';
import { recordPayment } from '@/lib/actions/payments/record-payment';
import { voidPayment } from '@/lib/actions/payments/void-payment';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

function journalTags(): string[] {
  const raw = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  return raw.entries.map((e) => e.tag);
}

async function applyMigrations(pg: PGlite, tags: string[]): Promise<void> {
  for (const tag of tags) {
    const statements = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await pg.exec(statement);
  }
}

async function insertOne(pg: PGlite, sqlText: string, params: unknown[] = []): Promise<string> {
  const result = await pg.query<{ id: string }>(sqlText, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned for: ${sqlText}`);
  return row.id;
}

function ok<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(`expected success but got ${result.error.code}: ${result.error.message}`);
  return result.data;
}

function failsWith<T>(result: ActionResult<T>, code: string, message?: RegExp): void {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe(code);
    if (message) expect(result.error.message).toMatch(message);
  }
}

function istDaysAgo(days: number): string {
  return formatIstDateAsIso(new Date(Date.now() - days * 86_400_000));
}

describe('Refunds: recording, limits, voids and audit integrity', () => {
  let pg: PGlite;
  let invoiceId: string;
  let lineId: string;
  let creditNoteId: string;
  const today = istDaysAgo(0);

  async function invoiceRow() {
    const res = await pg.query<{ payment_status: string; refund_due_paise: string | number }>(
      `SELECT payment_status, refund_due_paise FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    return { status: res.rows[0]!.payment_status, refundDue: Number(res.rows[0]!.refund_due_paise) };
  }

  async function entries() {
    const res = await pg.query<{ id: string; kind: string; amount_paise: string | number; status: string }>(
      `SELECT id, kind, amount_paise, status FROM payments WHERE invoice_id = $1 ORDER BY created_at, id`,
      [invoiceId],
    );
    return res.rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) }));
  }

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg, journalTags());
    state.db = drizzle(pg, { schema });

    state.businessId = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode, subscription_plan, subscription_status)
       VALUES ('Refund Traders', '27AABCU9603R1ZR', '1 Market Rd', 'Pune', '27', '411001', 'essentials', 'active') RETURNING id`,
    );
    await pg.query(
      `INSERT INTO users (id, auth_user_id, email, business_id, role, display_name)
       VALUES ($1, 'auth_refund', 'owner@refund.test', $2, 'owner', 'Owner')`,
      [USER_ID, state.businessId],
    );
    const fyId = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [state.businessId],
    );

    // Invoice dated 10 days ago: 10 x Rs10 + 5 x Rs20 = Rs200, 0% GST (totals stay exact).
    invoiceId = await insertOne(
      pg,
      `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, due_date,
         place_of_supply_state_code, subtotal_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, total_tax_paise, grand_total_paise)
       VALUES ($1, $2, 'DRAFT-REFUND', 'draft', $3::date, $3::date + 30, '27', 20000, 0, 0, 0, 0, 20000) RETURNING id`,
      [state.businessId, fyId, istDaysAgo(10)],
    );
    lineId = await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise, sort_order)
       VALUES ($1, 'Notebook', '4820', 10, 'NOS', 1000, 10000, 0, 0, 0, 0, 10000, 0) RETURNING id`,
      [invoiceId],
    );
    await insertOne(
      pg,
      `INSERT INTO invoice_line_items (invoice_id, description, hsn_sac_code, quantity, unit_of_measurement, unit_price_paise,
         taxable_value_paise, tax_rate_percentage, cgst_paise, sgst_paise, igst_paise, line_total_paise, sort_order)
       VALUES ($1, 'Pen Box', '9608', 5, 'NOS', 2000, 10000, 0, 0, 0, 0, 10000, 1) RETURNING id`,
      [invoiceId],
    );
    const ormDb = drizzle(pg, { schema });
    await ormDb.transaction(async (tx) => {
      await finalizeDraftInvoiceInTransaction(tx as unknown as Parameters<typeof finalizeDraftInvoiceInTransaction>[0], {
        invoiceId,
        businessId: state.businessId,
        actorUserId: USER_ID,
        requestContext: { ip: '127.0.0.1', userAgent: 'vitest' },
      });
    });
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('1. paid in full by two payments: no refund due, and a refund is refused', async () => {
    ok(await recordPayment({ invoice_id: invoiceId, amount: 120, payment_date: istDaysAgo(8), payment_method: 'upi' }));
    ok(await recordPayment({ invoice_id: invoiceId, amount: 80, payment_date: istDaysAgo(7), payment_method: 'cash' }));
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 0 });
    failsWith(
      await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 1, payment_date: today, payment_method: 'cash' }),
      'NO_REFUND_DUE',
    );
  });

  it('2. a Rs30 credit note on the settled invoice creates a Rs30 refund due (stored on the invoice)', async () => {
    const draft = ok(
      await saveCreditNoteDraft({
        original_invoice_id: invoiceId,
        reason: '01-sales-return',
        issue_date: istDaysAgo(3),
        line_items: [{ original_line_item_id: lineId, quantity: 3 }],
      }),
    );
    ok(await finalizeCreditNote({ id: draft.id }));
    creditNoteId = draft.id;
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 3000 });
    // No more payments can be taken while money is owed back.
    failsWith(
      await recordPayment({ invoice_id: invoiceId, amount: 1, payment_date: today, payment_method: 'upi' }),
      'OVERPAYMENT',
    );
  });

  it('3. a refund larger than the refund due, or dated before the credit note, is refused', async () => {
    failsWith(
      await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 30.01, payment_date: today, payment_method: 'upi' }),
      'OVER_REFUND',
      /more than the refund due of ₹30\.00/,
    );
    failsWith(
      await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 10, payment_date: istDaysAgo(5), payment_method: 'upi' }),
      'INVALID_DATE',
      /before the credit note date/,
    );
    failsWith(
      await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 10, payment_date: istDaysAgo(-1), payment_method: 'upi' }),
      'INVALID_DATE',
      /future/,
    );
    expect((await entries()).filter((e) => e.kind === 'refund')).toHaveLength(0);
  });

  it('4. partial then final refund: refund due 30 -> 10 -> 0, audited as record_refund', async () => {
    const first = ok(await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 20, payment_date: today, payment_method: 'upi' }));
    expect(first.refund_due_paise).toBe(1000);
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 1000 });

    const last = ok(await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 10, payment_date: today, payment_method: 'cash', reference_number: 'CASH-RET-1' }));
    expect(last.refund_due_paise).toBe(0);
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 0 });

    const refunds = (await entries()).filter((e) => e.kind === 'refund');
    expect(refunds.map((r) => r.amount_paise)).toEqual([2000, 1000]);

    const audit = await pg.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM audit_log WHERE entity_type = 'payment' AND action = 'record_refund' AND business_id = $1`,
      [state.businessId],
    );
    expect(audit.rows[0]!.c).toBe(2);

    // Fully refunded: nothing more may go back.
    failsWith(
      await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 1, payment_date: today, payment_method: 'cash' }),
      'NO_REFUND_DUE',
    );
  });

  it('5. voiding the credit note is refused while its amount has been refunded', async () => {
    failsWith(
      await voidCreditNote({ id: creditNoteId, reason: 'data_entry_error', notes: 'test', confirm: true }),
      'REFUND_NOT_COVERED',
      /already been refunded/,
    );
    const cn = await pg.query<{ status: string }>(`SELECT status FROM credit_notes WHERE id = $1`, [creditNoteId]);
    expect(cn.rows[0]!.status).toBe('active'); // rolled back
  });

  it('6. voiding a payment that the refunds depend on is refused', async () => {
    const upi = (await entries()).find((e) => e.kind === 'payment' && e.amount_paise === 12000)!;
    failsWith(
      await voidPayment({ id: upi.id, reason: 'clerical_error', notes: 'test void' }),
      'REFUND_NOT_COVERED',
      /Void the refund entry first/,
    );
    expect((await entries()).find((e) => e.id === upi.id)!.status).toBe('active');
  });

  it('7. a failed refund is voided: the refund due comes back and can be recorded again', async () => {
    const cashRefund = (await entries()).find((e) => e.kind === 'refund' && e.amount_paise === 1000)!;
    ok(await voidPayment({ id: cashRefund.id, reason: 'refund_failed', notes: 'customer bank returned it' }));
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 1000 });
    ok(await recordPayment({ invoice_id: invoiceId, kind: 'refund', amount: 10, payment_date: today, payment_method: 'bank_transfer' }));
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 0 });
  });

  it('8. once refunds are voided first, the credit note can be voided and the invoice is settled again', async () => {
    for (const r of (await entries()).filter((e) => e.kind === 'refund' && e.status === 'active')) {
      ok(await voidPayment({ id: r.id, reason: 'clerical_error', notes: 'undo for test' }));
    }
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 3000 });
    ok(await voidCreditNote({ id: creditNoteId, reason: 'data_entry_error', notes: 'test', confirm: true }));
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 0 });
  });

  it('9. payment rows are append-only in the database: no delete, no edit of money fields, voided rows frozen', async () => {
    const [first] = await entries();
    await expect(pg.query(`DELETE FROM payments WHERE id = $1`, [first!.id])).rejects.toThrow(/cannot be deleted/);
    await expect(pg.query(`UPDATE payments SET amount_paise = 1 WHERE id = $1`, [first!.id])).rejects.toThrow(/cannot change column\(s\): amount_paise/);
    await expect(pg.query(`UPDATE payments SET kind = 'refund' WHERE id = $1`, [first!.id])).rejects.toThrow(/kind/);
    const voided = (await entries()).find((e) => e.status === 'voided')!;
    await expect(pg.query(`UPDATE payments SET void_notes = 'edited' WHERE id = $1`, [voided.id])).rejects.toThrow(/voided payment/);
    await expect(pg.query(`UPDATE payments SET kind = 'gift' WHERE id = $1`, [first!.id])).rejects.toThrow();
  });

  it('10. finalized invoices still cannot change their money, but refund_due_paise may be maintained', async () => {
    await expect(pg.query(`UPDATE invoices SET grand_total_paise = 1 WHERE id = $1`, [invoiceId])).rejects.toThrow(/grand_total_paise/);
    await pg.query(`UPDATE invoices SET refund_due_paise = refund_due_paise WHERE id = $1`, [invoiceId]);
    await expect(pg.query(`UPDATE invoices SET refund_due_paise = -1 WHERE id = $1`, [invoiceId])).rejects.toThrow();
  });

  it('11. BUG-05: a payment that committed is reported as SUCCESS even if page revalidation then fails', async () => {
    // Re-open Rs80 of the balance by voiding the Rs80 cash payment (no refunds depend on it any more).
    const cash = (await entries()).find((e) => e.kind === 'payment' && e.amount_paise === 8000 && e.status === 'active')!;
    ok(await voidPayment({ id: cash.id, reason: 'clerical_error', notes: 'reopen for BUG-05 test' }));
    const before = (await entries()).filter((e) => e.status === 'active').length;

    revalidatePathMock.mockClear(); // forget the void's calls, so the checks below are about recordPayment only
    revalidatePathMock.mockImplementation(() => {
      throw new Error('revalidate failed after commit');
    });
    try {
      const result = await recordPayment({ invoice_id: invoiceId, amount: 80, payment_date: today, payment_method: 'upi' });
      // Before the fix this was { success: false, code: 'INTERNAL_ERROR' } for a payment that WAS saved, so the form
      // unlocked and a retry recorded it twice.
      expect(result.success).toBe(true);
      // recordPayment itself hit the failing revalidation, for both pages (one failure does not stop the next).
      expect(revalidatePathMock.mock.calls).toEqual([['/invoices'], [`/invoices/${invoiceId}`]]);
    } finally {
      revalidatePathMock.mockReset();
      revalidatePathMock.mockImplementation(() => undefined);
    }
    const after = (await entries()).filter((e) => e.status === 'active');
    expect(after.length).toBe(before + 1); // saved exactly once
    expect(await invoiceRow()).toEqual({ status: 'paid', refundDue: 0 });
  });
});

describe('Refunds migration backfill', () => {
  it('computes refund due for invoices already over-paid after a credit note, and leaves others at 0', async () => {
    const pg = new PGlite();
    const tags = journalTags();
    const refundsIdx = tags.findIndex((t) => t.endsWith('_refunds'));
    expect(refundsIdx).toBeGreaterThan(0);
    await applyMigrations(pg, tags.slice(0, refundsIdx));

    const biz = await insertOne(
      pg,
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Backfill Co', '27AABCU9603R1ZS', '1 Rd', 'Pune', '27', '411001') RETURNING id`,
    );
    const fy = await insertOne(
      pg,
      `INSERT INTO financial_years (business_id, label, start_date, end_date, is_current) VALUES ($1, '2026-27', '2026-04-01', '2027-03-31', true) RETURNING id`,
      [biz],
    );
    async function finalizedInvoice(no: string, grand: number): Promise<string> {
      const id = await insertOne(
        pg,
        `INSERT INTO invoices (business_id, financial_year_id, invoice_number, lifecycle_status, invoice_date, place_of_supply_state_code,
           subtotal_paise, total_tax_paise, grand_total_paise)
         VALUES ($1, $2, $3, 'draft', '2026-06-01', '27', $4, 0, $4) RETURNING id`,
        [biz, fy, no, grand],
      );
      await pg.query(
        `UPDATE invoices SET lifecycle_status = 'finalized', invoice_sequence = $2, finalized_at = now(),
           seller_name_snapshot = 'Backfill Co', seller_address_snapshot = '{"line1":"1 Rd"}', seller_state_code_snapshot = '27',
           seller_snapshot_source = 'captured_at_finalization' WHERE id = $1`,
        [id, Number(no.slice(-1))],
      );
      return id;
    }
    const settled = await finalizedInvoice('INV-1', 10000);
    const unpaid = await finalizedInvoice('INV-2', 10000);
    for (const [inv, amount] of [[settled, 10000], [unpaid, 2000]] as const) {
      await pg.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method) VALUES ($1, $2, $3, '2026-06-02', 'upi')`,
        [biz, inv, amount],
      );
    }
    for (const [inv, seq] of [[settled, 1], [unpaid, 2]] as const) {
      await pg.query(
        `INSERT INTO credit_notes (business_id, financial_year_id, original_invoice_id, credit_note_number, credit_note_sequence, lifecycle_status,
           status, issue_date, reason, subtotal_paise, total_tax_paise, grand_total_paise, finalized_at,
           seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source, seller_gstin_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'finalized', 'active', '2026-06-03', '01-sales-return', 2500, 0, 2500, now(),
           'Backfill Co', '{"line1":"1 Rd"}', '27', 'captured_at_finalization', '27AABCU9603R1ZS')`,
        [biz, fy, inv, `CN-${seq}`, seq],
      );
    }

    await applyMigrations(pg, tags.slice(refundsIdx, refundsIdx + 1));

    const rows = await pg.query<{ invoice_number: string; refund_due_paise: string | number }>(
      `SELECT invoice_number, refund_due_paise FROM invoices ORDER BY invoice_number`,
    );
    expect(rows.rows.map((r) => [r.invoice_number, Number(r.refund_due_paise)])).toEqual([
      ['INV-1', 2500], // paid 100 on a bill reduced to 75
      ['INV-2', 0], // paid 20 on a bill reduced to 75: still owes, nothing to refund
    ]);
    const kinds = await pg.query<{ kind: string }>(`SELECT DISTINCT kind FROM payments`);
    expect(kinds.rows.map((r) => r.kind)).toEqual(['payment']);
    await pg.close();
  }, 60_000);
});
