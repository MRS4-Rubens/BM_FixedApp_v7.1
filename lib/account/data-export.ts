import { eq, and, asc } from 'drizzle-orm';
import {
  businesses,
  users,
  customers,
  products,
  financialYears,
  invoices,
  invoiceLineItems,
  creditNotes,
  creditNoteLineItems,
  payments,
  subscriptionRequests,
} from '@/lib/db/schema';
import type { db } from '@/lib/db/client';

export const DATA_EXPORT_FORMAT = 'bill-matrix-data-export';
export const DATA_EXPORT_VERSION = 1;

/**
 * Explicit denylist of internal infrastructure, storage pointer, and authentication columns
 * that MUST NOT be included in data exports under DPDP right of access.
 */
export const EXPORT_FIELD_DENYLIST = [
  'auth_user_id',
  'archival_attempts',
  'archival_claimed_at',
  'archival_status',
  'archived_at',
  'screenshot_key',
] as const;

export function shouldOmitField(key: string): boolean {
  if (
    key.endsWith('_storage_key') ||
    key.endsWith('storage_key') ||
    key.endsWith('storage_key_snapshot') ||
    (key.endsWith('_key') && (key.includes('storage') || key.includes('screenshot'))) ||
    key === 'screenshot_key'
  ) {
    return true;
  }
  return (EXPORT_FIELD_DENYLIST as readonly string[]).includes(key);
}

export function sanitizeExportRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (shouldOmitField(key)) {
      continue;
    }
    result[key] = sanitizeExportValue(value);
  }
  return result;
}

export function sanitizeExportValue(val: unknown): unknown {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'bigint') {
    return Number(val);
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeExportValue);
  }
  if (val !== null && typeof val === 'object') {
    return sanitizeExportRecord(val as Record<string, unknown>);
  }
  return val;
}

export interface DataExport {
  readonly format: typeof DATA_EXPORT_FORMAT;
  readonly version: typeof DATA_EXPORT_VERSION;
  readonly exported_at: string;
  readonly business: Record<string, unknown> | null;
  readonly users: Record<string, unknown>[];
  readonly customers: Record<string, unknown>[];
  readonly products: Record<string, unknown>[];
  readonly financial_years: Record<string, unknown>[];
  readonly invoices: (Record<string, unknown> & { line_items: Record<string, unknown>[] })[];
  readonly credit_notes: (Record<string, unknown> & { line_items: Record<string, unknown>[] })[];
  readonly payments: Record<string, unknown>[];
  readonly subscription_requests: Record<string, unknown>[];
}

type QueryableDb = {
  select: typeof db.select;
};

export async function loadDataExport(
  database: QueryableDb,
  businessId: string,
): Promise<DataExport> {
  // 1. Business profile
  const bizRows = await database
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const business = bizRows[0] ? sanitizeExportRecord(bizRows[0]) : null;

  // 2. Users (filtered by business_id)
  const userRows = await database
    .select()
    .from(users)
    .where(eq(users.business_id, businessId))
    .orderBy(asc(users.created_at), asc(users.id));

  // 3. Customers (filtered by business_id)
  const customerRows = await database
    .select()
    .from(customers)
    .where(eq(customers.business_id, businessId))
    .orderBy(asc(customers.created_at), asc(customers.id));

  // 4. Products (filtered by business_id)
  const productRows = await database
    .select()
    .from(products)
    .where(eq(products.business_id, businessId))
    .orderBy(asc(products.created_at), asc(products.id));

  // 5. Financial Years (filtered by business_id)
  const fyRows = await database
    .select()
    .from(financialYears)
    .where(eq(financialYears.business_id, businessId))
    .orderBy(asc(financialYears.start_date), asc(financialYears.id));

  // 6. Invoices (filtered by business_id) & their line items
  const invoiceRows = await database
    .select()
    .from(invoices)
    .where(eq(invoices.business_id, businessId))
    .orderBy(asc(invoices.created_at), asc(invoices.id));

  const invoiceLineRows = await database
    .select({
      item: invoiceLineItems,
    })
    .from(invoiceLineItems)
    .innerJoin(
      invoices,
      and(
        eq(invoiceLineItems.invoice_id, invoices.id),
        eq(invoices.business_id, businessId),
      ),
    )
    .orderBy(asc(invoiceLineItems.sort_order), asc(invoiceLineItems.created_at));

  const lineItemsByInvoiceId = new Map<string, Record<string, unknown>[]>();
  for (const row of invoiceLineRows) {
    const list = lineItemsByInvoiceId.get(row.item.invoice_id) ?? [];
    list.push(sanitizeExportRecord(row.item));
    lineItemsByInvoiceId.set(row.item.invoice_id, list);
  }

  const sanitizedInvoices = invoiceRows.map((inv) => ({
    ...sanitizeExportRecord(inv),
    line_items: lineItemsByInvoiceId.get(inv.id) ?? [],
  }));

  // 7. Credit Notes (filtered by business_id) & their line items
  const creditNoteRows = await database
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.business_id, businessId))
    .orderBy(asc(creditNotes.created_at), asc(creditNotes.id));

  const creditNoteLineRows = await database
    .select({
      item: creditNoteLineItems,
    })
    .from(creditNoteLineItems)
    .innerJoin(
      creditNotes,
      and(
        eq(creditNoteLineItems.credit_note_id, creditNotes.id),
        eq(creditNotes.business_id, businessId),
      ),
    )
    .orderBy(asc(creditNoteLineItems.sort_order), asc(creditNoteLineItems.created_at));

  const lineItemsByCreditNoteId = new Map<string, Record<string, unknown>[]>();
  for (const row of creditNoteLineRows) {
    const list = lineItemsByCreditNoteId.get(row.item.credit_note_id) ?? [];
    list.push(sanitizeExportRecord(row.item));
    lineItemsByCreditNoteId.set(row.item.credit_note_id, list);
  }

  const sanitizedCreditNotes = creditNoteRows.map((cn) => ({
    ...sanitizeExportRecord(cn),
    line_items: lineItemsByCreditNoteId.get(cn.id) ?? [],
  }));

  // 8. Payments (filtered by business_id)
  const paymentRows = await database
    .select()
    .from(payments)
    .where(eq(payments.business_id, businessId))
    .orderBy(asc(payments.created_at), asc(payments.id));

  // 9. Subscription Requests (filtered by business_id)
  const subRows = await database
    .select()
    .from(subscriptionRequests)
    .where(eq(subscriptionRequests.business_id, businessId))
    .orderBy(asc(subscriptionRequests.created_at), asc(subscriptionRequests.id));

  return {
    format: DATA_EXPORT_FORMAT,
    version: DATA_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    business,
    users: userRows.map(sanitizeExportRecord),
    customers: customerRows.map(sanitizeExportRecord),
    products: productRows.map(sanitizeExportRecord),
    financial_years: fyRows.map(sanitizeExportRecord),
    invoices: sanitizedInvoices,
    credit_notes: sanitizedCreditNotes,
    payments: paymentRows.map(sanitizeExportRecord),
    subscription_requests: subRows.map(sanitizeExportRecord),
  };
}

