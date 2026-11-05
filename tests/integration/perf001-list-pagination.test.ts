import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { getDisplayInvoiceStatus } from '@/lib/invoices/status';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  businessId: '',
  userId: 'a0000000-0000-4000-8000-000000000001',
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

import { listInvoices } from '@/lib/actions/invoices/list-invoices';
import { listCustomers } from '@/lib/actions/customers/list-customers';
import { listPayments } from '@/lib/actions/payments/list-payments';
import { searchCustomerOptions } from '@/lib/actions/customers/search-customer-options';
import { searchProductOptions } from '@/lib/actions/products/search-product-options';

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

let seqCounter = 1;

async function insertInvoice(
  pg: PGlite,
  data: {
    businessId: string;
    financialYearId: string;
    customerId?: string | null;
    invoiceNumber: string;
    lifecycleStatus?: 'draft' | 'finalized';
    paymentStatus?: 'unpaid' | 'partially_paid' | 'paid';
    invoiceDate?: string;
    dueDate?: string | null;
    grandTotalPaise?: number;
    createdAt?: Date;
  },
): Promise<string> {
  const isFinalized = (data.lifecycleStatus ?? 'finalized') === 'finalized';
  const seq = isFinalized ? seqCounter++ : null;
  const res = await pg.query<{ id: string }>(
    `INSERT INTO invoices (
       business_id, financial_year_id, customer_id, invoice_number, invoice_sequence,
       lifecycle_status, payment_status, invoice_date, due_date, grand_total_paise,
       finalized_at, seller_name_snapshot, seller_address_snapshot, seller_state_code_snapshot, seller_snapshot_source,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id;`,
    [
      data.businessId,
      data.financialYearId,
      data.customerId ?? null,
      data.invoiceNumber,
      seq,
      data.lifecycleStatus ?? 'finalized',
      data.paymentStatus ?? 'unpaid',
      data.invoiceDate ?? '2026-11-01',
      data.dueDate ?? null,
      data.grandTotalPaise ?? 5000,
      isFinalized ? (data.createdAt ?? new Date()) : null,
      isFinalized ? 'Tenant Legal Name' : null,
      isFinalized ? JSON.stringify({ line1: '100 Road', line2: null, city: 'Bengaluru', pincode: '560001' }) : null,
      isFinalized ? '29' : null,
      isFinalized ? 'captured_at_finalization' : null,
      data.createdAt ?? new Date(),
    ],
  );
  return res.rows[0].id;
}

describe('PERF-001 Keyset Pagination, Filters & Pickers Integration', () => {
  let pg: PGlite;
  let tenantAId: string;
  let tenantBId: string;
  let tenantAFyId: string;

  beforeAll(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    state.db = drizzle(pg, { schema });

    // Seed Tenant A
    const resA = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant A Corp', '29ABCDE1234F1Z5', '100 A St', 'Bengaluru', '29', '560001')
       RETURNING id;`,
    );
    tenantAId = resA.rows[0].id;

    const fyA = await pg.query<{ id: string }>(
      `INSERT INTO financial_years (business_id, label, start_date, end_date)
       VALUES ($1, '2026-2027', '2026-04-01', '2027-03-31')
       RETURNING id;`,
      [tenantAId],
    );
    tenantAFyId = fyA.rows[0].id;

    // Seed Tenant B
    const resB = await pg.query<{ id: string }>(
      `INSERT INTO businesses (legal_name, gstin, address_line1, city, state_code, pincode)
       VALUES ('Tenant B Corp', '27ABCDE1234F1Z6', '200 B St', 'Mumbai', '27', '400001')
       RETURNING id;`,
    );
    tenantBId = resB.rows[0].id;

    state.businessId = tenantAId;
  }, 60_000);

  afterAll(async () => {
    if (pg) {
      await pg.close();
    }
  });

  it('Scenario 1: Stable keyset ordering across pages (forward & backward)', async () => {
    state.businessId = tenantAId;

    const cRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, 'Customer Alpha', '29') RETURNING id;`,
      [tenantAId],
    );
    const customerId = cRes.rows[0].id;

    // Insert 5 invoices with distinct created_at
    for (let i = 1; i <= 5; i++) {
      await insertInvoice(pg, {
        businessId: tenantAId,
        financialYearId: tenantAFyId,
        customerId,
        invoiceNumber: `INV-A-00${i}`,
        invoiceDate: '2026-11-01',
        createdAt: new Date(`2026-11-01T10:00:0${i}.000Z`),
      });
    }

    // Page 1: limit 2
    const p1 = await listInvoices({ limit: 2, month: 11, year: 2026 });
    expect(p1.success).toBe(true);
    if (!p1.success) return;

    expect(p1.data.items).toHaveLength(2);
    expect(p1.data.items[0].invoice_number).toBe('INV-A-005');
    expect(p1.data.items[1].invoice_number).toBe('INV-A-004');
    expect(p1.data.pageInfo.hasNextPage).toBe(true);
    expect(p1.data.pageInfo.endCursor).toBeDefined();

    // Page 2: after page 1
    const p2 = await listInvoices({
      limit: 2,
      month: 11,
      year: 2026,
      after: p1.data.pageInfo.endCursor ?? undefined,
    });
    expect(p2.success).toBe(true);
    if (!p2.success) return;

    expect(p2.data.items).toHaveLength(2);
    expect(p2.data.items[0].invoice_number).toBe('INV-A-003');
    expect(p2.data.items[1].invoice_number).toBe('INV-A-002');
    expect(p2.data.pageInfo.hasNextPage).toBe(true);

    // Page 3: after page 2
    const p3 = await listInvoices({
      limit: 2,
      month: 11,
      year: 2026,
      after: p2.data.pageInfo.endCursor ?? undefined,
    });
    expect(p3.success).toBe(true);
    if (!p3.success) return;

    expect(p3.data.items).toHaveLength(1);
    expect(p3.data.items[0].invoice_number).toBe('INV-A-001');
    expect(p3.data.pageInfo.hasNextPage).toBe(false);

    // Backward pagination: from Page 2 back to Page 1
    const backToP1 = await listInvoices({
      limit: 2,
      month: 11,
      year: 2026,
      before: p2.data.pageInfo.startCursor ?? undefined,
    });
    expect(backToP1.success).toBe(true);
    if (!backToP1.success) return;

    expect(backToP1.data.items).toHaveLength(2);
    expect(backToP1.data.items[0].invoice_number).toBe('INV-A-005');
    expect(backToP1.data.items[1].invoice_number).toBe('INV-A-004');
  });

  it('Scenario 2: Microsecond tie handling produces deterministic cursor ordering without duplicates or skips', async () => {
    state.businessId = tenantAId;

    const cRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, 'Tie Customer', '29') RETURNING id;`,
      [tenantAId],
    );
    const customerId = cRes.rows[0].id;

    // Exact identical timestamp
    const exactSameTime = new Date('2026-10-15T12:00:00.123Z');
    const tieNumbers = ['INV-TIE-1', 'INV-TIE-2', 'INV-TIE-3', 'INV-TIE-4'];

    for (const num of tieNumbers) {
      await insertInvoice(pg, {
        businessId: tenantAId,
        financialYearId: tenantAFyId,
        customerId,
        invoiceNumber: num,
        invoiceDate: '2026-10-15',
        createdAt: exactSameTime,
      });
    }

    // Page 1: limit 2
    const page1 = await listInvoices({ limit: 2, month: 10, year: 2026 });
    expect(page1.success).toBe(true);
    if (!page1.success) return;

    expect(page1.data.items).toHaveLength(2);

    // Page 2: limit 2 after page 1
    const page2 = await listInvoices({
      limit: 2,
      month: 10,
      year: 2026,
      after: page1.data.pageInfo.endCursor ?? undefined,
    });
    expect(page2.success).toBe(true);
    if (!page2.success) return;

    expect(page2.data.items).toHaveLength(2);

    const allReturnedNumbers = [
      ...page1.data.items.map((i) => i.invoice_number),
      ...page2.data.items.map((i) => i.invoice_number),
    ];

    // Zero duplicates and all 4 retrieved
    const uniqueNumbers = new Set(allReturnedNumbers);
    expect(uniqueNumbers.size).toBe(4);
    for (const num of tieNumbers) {
      expect(uniqueNumbers.has(num)).toBe(true);
    }
  });

  it('Scenario 3: Concurrent insert does not cause page 2 to drift or duplicate', async () => {
    state.businessId = tenantAId;

    const cRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, 'Drift Customer', '29') RETURNING id;`,
      [tenantAId],
    );
    const customerId = cRes.rows[0].id;

    for (let i = 1; i <= 4; i++) {
      await insertInvoice(pg, {
        businessId: tenantAId,
        financialYearId: tenantAFyId,
        customerId,
        invoiceNumber: `INV-DRIFT-${i}`,
        invoiceDate: '2026-09-01',
        createdAt: new Date(`2026-09-01T10:00:0${i}.000Z`),
      });
    }

    // Fetch page 1 (size 2) -> returns DRIFT-4, DRIFT-3
    const p1 = await listInvoices({ limit: 2, month: 9, year: 2026 });
    expect(p1.success).toBe(true);
    if (!p1.success) return;

    expect(p1.data.items[0].invoice_number).toBe('INV-DRIFT-4');
    expect(p1.data.items[1].invoice_number).toBe('INV-DRIFT-3');

    // Simulate concurrent insert of NEWER invoice
    await insertInvoice(pg, {
      businessId: tenantAId,
      financialYearId: tenantAFyId,
      customerId,
      invoiceNumber: 'INV-DRIFT-NEW',
      invoiceDate: '2026-09-01',
      createdAt: new Date('2026-09-01T10:00:09.000Z'),
    });

    // Fetch page 2 using cursor from p1
    const p2 = await listInvoices({
      limit: 2,
      month: 9,
      year: 2026,
      after: p1.data.pageInfo.endCursor ?? undefined,
    });
    expect(p2.success).toBe(true);
    if (!p2.success) return;

    // In keyset pagination, page 2 remains exactly DRIFT-2, DRIFT-1
    expect(p2.data.items).toHaveLength(2);
    expect(p2.data.items[0].invoice_number).toBe('INV-DRIFT-2');
    expect(p2.data.items[1].invoice_number).toBe('INV-DRIFT-1');
  });

  it('Scenario 4: Tenant isolation strictly enforced on lists and counts', async () => {
    // Insert identical customer names for Tenant A and Tenant B
    await pg.query(
      `INSERT INTO customers (business_id, name, state_code) VALUES ($1, 'Target Corp', '29');`,
      [tenantAId],
    );
    await pg.query(
      `INSERT INTO customers (business_id, name, state_code) VALUES ($1, 'Target Corp', '27');`,
      [tenantBId],
    );

    // Caller is Tenant A
    state.businessId = tenantAId;
    const resA = await listCustomers({ q: 'Target Corp' });
    expect(resA.success).toBe(true);
    if (!resA.success) return;

    expect(resA.data.items).toHaveLength(1);
    expect(resA.data.items[0].business_id).toBe(tenantAId);

    // Caller is Tenant B
    state.businessId = tenantBId;
    const resB = await listCustomers({ q: 'Target Corp' });
    expect(resB.success).toBe(true);
    if (!resB.success) return;

    expect(resB.data.items).toHaveLength(1);
    expect(resB.data.items[0].business_id).toBe(tenantBId);
  });

  it('Scenario 5: Search escaping ensures % and _ are treated as literal characters', async () => {
    state.businessId = tenantAId;

    await pg.query(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, '100% Organic Juice Ltd', '29'),
              ($1, '1000 Organic Juice Ltd', '29');`,
      [tenantAId],
    );

    const searchResult = await listCustomers({ q: '100%' });
    expect(searchResult.success).toBe(true);
    if (!searchResult.success) return;

    expect(searchResult.data.items).toHaveLength(1);
    expect(searchResult.data.items[0].name).toBe('100% Organic Juice Ltd');
  });

  it('Scenario 6: Status parity with getDisplayInvoiceStatus', async () => {
    state.businessId = tenantAId;

    const cRes = await pg.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, state_code)
       VALUES ($1, 'Status Cust', '29') RETURNING id;`,
      [tenantAId],
    );
    const customerId = cRes.rows[0].id;

    // Today in IST
    const today = new Date();

    // 1. Draft
    await insertInvoice(pg, {
      businessId: tenantAId,
      financialYearId: tenantAFyId,
      customerId,
      invoiceNumber: 'INV-STAT-DRAFT',
      lifecycleStatus: 'draft',
      paymentStatus: 'unpaid',
      invoiceDate: '2026-11-01',
    });

    // 2. Paid
    await insertInvoice(pg, {
      businessId: tenantAId,
      financialYearId: tenantAFyId,
      customerId,
      invoiceNumber: 'INV-STAT-PAID',
      lifecycleStatus: 'finalized',
      paymentStatus: 'paid',
      invoiceDate: '2026-11-01',
    });

    // 3. Overdue (due date in past)
    await insertInvoice(pg, {
      businessId: tenantAId,
      financialYearId: tenantAFyId,
      customerId,
      invoiceNumber: 'INV-STAT-OVERDUE',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-02',
    });

    const draftList = await listInvoices({ status: 'draft', month: 11, year: 2026 });
    expect(draftList.success).toBe(true);
    if (draftList.success) {
      const match = draftList.data.items.find((i) => i.invoice_number === 'INV-STAT-DRAFT');
      expect(match).toBeDefined();
      if (match) {
        expect(getDisplayInvoiceStatus(match, today)).toBe('draft');
      }
    }

    const paidList = await listInvoices({ status: 'paid', month: 11, year: 2026 });
    expect(paidList.success).toBe(true);
    if (paidList.success) {
      const match = paidList.data.items.find((i) => i.invoice_number === 'INV-STAT-PAID');
      expect(match).toBeDefined();
      if (match) {
        expect(getDisplayInvoiceStatus(match, today)).toBe('paid');
      }
    }

    const overdueList = await listInvoices({ status: 'overdue', month: 11, year: 2026 });
    expect(overdueList.success).toBe(true);
    if (overdueList.success) {
      const match = overdueList.data.items.find((i) => i.invoice_number === 'INV-STAT-OVERDUE');
      expect(match).toBeDefined();
      if (match) {
        expect(getDisplayInvoiceStatus(match, today)).toBe('overdue');
      }
    }
  });

  it('Scenario 7: Pickers respect prefix priority, limit, and active-only scoping', async () => {
    state.businessId = tenantAId;

    await pg.query(
      `INSERT INTO customers (business_id, name, state_code, is_active)
       VALUES ($1, 'Acme Retailers', '29', true),
              ($1, 'Global Acme Tech', '29', true),
              ($1, 'Acme Wholesale (Inactive)', '29', false);`,
      [tenantAId],
    );

    const pickerRes = await searchCustomerOptions({ q: 'Acme', limit: 5 });
    expect(pickerRes.success).toBe(true);
    if (!pickerRes.success) return;

    // Both active matches are returned; prefix match 'Acme Retailers' is prioritized
    expect(pickerRes.data.length).toBe(2);
    expect(pickerRes.data[0].name).toBe('Acme Retailers');
    expect(pickerRes.data[1].name).toBe('Global Acme Tech');
    expect(pickerRes.data.some((c) => c.name.includes('Inactive'))).toBe(false);

    // Products picker test
    await pg.query(
      `INSERT INTO products (business_id, name, default_sale_price_paise, hsn_sac_code, is_active)
       VALUES ($1, 'Acme Widget', 10000, '998311', true),
              ($1, 'Super Acme Gadget', 20000, '998312', true),
              ($1, 'Acme Old Tool (Inactive)', 5000, '998313', false);`,
      [tenantAId],
    );

    const prodPickerRes = await searchProductOptions({ q: 'Acme', limit: 5 });
    expect(prodPickerRes.success).toBe(true);
    if (!prodPickerRes.success) return;

    expect(prodPickerRes.data.length).toBe(2);
    expect(prodPickerRes.data[0].name).toBe('Acme Widget');
    expect(prodPickerRes.data[1].name).toBe('Super Acme Gadget');
    expect(prodPickerRes.data.some((p) => p.name.includes('Inactive'))).toBe(false);
  });

  it('Scenario 8: listPayments enforces hard 200 cap per invoice', async () => {
    state.businessId = tenantAId;

    const invoiceId = await insertInvoice(pg, {
      businessId: tenantAId,
      financialYearId: tenantAFyId,
      invoiceNumber: 'INV-PAY-CAP',
      lifecycleStatus: 'finalized',
      paymentStatus: 'unpaid',
      grandTotalPaise: 1000000,
    });

    // Insert 220 payments
    for (let i = 1; i <= 220; i++) {
      await pg.query(
        `INSERT INTO payments (business_id, invoice_id, amount_paise, payment_date, payment_method)
         VALUES ($1, $2, 100, '2026-11-01', 'upi');`,
        [tenantAId, invoiceId],
      );
    }

    const payResult = await listPayments({ invoice_id: invoiceId });
    expect(payResult.success).toBe(true);
    if (!payResult.success) return;

    expect(payResult.data.length).toBe(200);
  });
});
