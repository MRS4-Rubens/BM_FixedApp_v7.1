import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { computeGstinCheckChar } from '@/lib/gst/gstin';
import type { TestDb, TestBusiness } from './db';

export interface TestUserRecord {
  readonly id: string;
  readonly authUserId: string;
  readonly email: string;
  readonly businessId: string | null;
  readonly role: 'owner' | 'staff';
}

export async function createTestUser(
  testDb: TestDb,
  opts: {
    readonly email: string;
    readonly businessId?: string | null;
    readonly role?: 'owner' | 'staff';
    readonly displayName?: string;
  },
): Promise<TestUserRecord> {
  const authUserId = `auth-${randomBytes(8).toString('hex')}`;
  const [inserted] = await testDb
    .insert(schema.users)
    .values({
      auth_user_id: authUserId,
      email: opts.email,
      business_id: opts.businessId ?? null,
      role: opts.role ?? 'owner',
      display_name: opts.displayName ?? 'Test User',
    })
    .returning();

  if (!inserted) {
    throw new Error('Failed to create test user');
  }

  return {
    id: inserted.id,
    authUserId: inserted.auth_user_id,
    email: inserted.email ?? opts.email,
    businessId: inserted.business_id,
    role: inserted.role,
  };
}

export async function createPendingClaim(
  testDb: TestDb,
  opts: {
    readonly businessId: string;
    readonly userId: string;
    readonly plan?: 'essentials' | 'professional';
    readonly cycle?: 'monthly' | 'yearly';
    readonly amountPaise?: number;
    readonly utr?: string;
  },
): Promise<{ readonly id: string; readonly utr: string }> {
  const utr = opts.utr ?? `UTR-${randomBytes(8).toString('hex').toUpperCase()}`;
  const [claim] = await testDb
    .insert(schema.subscriptionRequests)
    .values({
      business_id: opts.businessId,
      user_id: opts.userId,
      plan_name: opts.plan ?? 'professional',
      billing_cycle: opts.cycle ?? 'monthly',
      amount_paise: opts.amountPaise ?? 99900,
      payment_method: 'upi_qr',
      payment_reference: utr,
      status: 'pending',
    })
    .returning();

  if (!claim) {
    throw new Error('Failed to insert pending subscription claim');
  }

  return { id: claim.id, utr };
}

export async function createFreePlanBusiness(
  testDb: TestDb,
  overrides?: Partial<typeof schema.businesses.$inferInsert>,
): Promise<TestBusiness> {
  const hex = randomBytes(4).toString('hex').toUpperCase();
  const gstin = makeValidGstin('27', randomPan());
  const legalName = `Free Plan Biz ${hex}`;

  const [biz] = await testDb
    .insert(schema.businesses)
    .values({
      legal_name: legalName,
      gstin,
      address_line1: '123 Free Street',
      city: 'Mumbai',
      state_code: '27',
      pincode: '400001',
      // Canonical Free tier as the app stores it (ALLOWED_STATUSES_BY_PLAN.free = expired | suspended).
      // 'free' + 'active' is not a state the app writes, and resolveBusinessPlan currently maps it to
      // Essentials (known defect F-ENT-3), which would silently disable every quota under test.
      subscription_plan: 'free',
      subscription_status: 'expired',
      invoice_number_format: 'INV/{YY}/{SEQ:4}',
      credit_note_number_prefix: 'CN',
      default_invoice_template: 'template_1',
      default_gst_rate_type: 'exclusive',
      payment_due_days: 30,
      ...overrides,
    })
    .returning();

  if (!biz) {
    throw new Error('Failed to create free plan business');
  }

  return {
    id: biz.id,
    gstin: biz.gstin,
    legalName: biz.legal_name,
  };
}

const PAN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Random PAN in the statutory shape AAAAA9999A (5 letters, 4 digits, 1 letter). */
export function randomPan(): string {
  const bytes = randomBytes(10);
  const letter = (i: number): string => PAN_LETTERS[(bytes[i] ?? 0) % 26] ?? 'A';
  const digit = (i: number): string => String((bytes[i] ?? 0) % 10);
  return `${letter(0)}${letter(1)}${letter(2)}${letter(3)}${letter(4)}${digit(5)}${digit(6)}${digit(7)}${digit(8)}${letter(9)}`;
}

export function makeValidGstin(stateCode: string, pan?: string, entity = '1'): string {
  const panPart = pan ?? randomPan();
  const first14 = `${stateCode}${panPart.slice(0, 10)}${entity}Z`;
  const checkChar = computeGstinCheckChar(first14);
  if (!checkChar) {
    throw new Error(`Failed to compute check character for GSTIN base ${first14}`);
  }
  return `${first14}${checkChar}`;
}

export async function readGaplessSequences(testDb: TestDb, businessId: string): Promise<number[]> {
  const rows = await testDb
    .select({
      invoiceNumber: schema.invoices.invoice_number,
      lifecycleStatus: schema.invoices.lifecycle_status,
      createdAt: schema.invoices.created_at,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.business_id, businessId),
        eq(schema.invoices.lifecycle_status, 'finalized'),
      ),
    )
    .orderBy(asc(schema.invoices.created_at), asc(schema.invoices.invoice_number));

  const sequences: number[] = [];
  for (const row of rows) {
    // Matches formats ending with sequence digits e.g. /0001 or -001
    const match = /(?:[\/\-])(\d{1,6})$/.exec(row.invoiceNumber);
    if (match) {
      sequences.push(parseInt(match[1], 10));
    }
  }
  // Concurrent finalizations commit in arbitrary order, so draft creation order says nothing about numbering.
  // "Gapless" is a property of the sorted set: it must be exactly 1..n.
  return sequences.sort((a, b) => a - b);
}
