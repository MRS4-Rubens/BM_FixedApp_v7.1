import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/client';
import { customers, products, taxRates } from '@/lib/db/schema';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { CUSTOMER_COLUMNS, PRODUCT_COLUMNS, type CustomerColumnKey, type ImportKind, type ProductColumnKey } from '@/lib/import/columns';
import { readImportFile, type SheetRow } from '@/lib/import/read-file';
import {
  checkCustomerRows,
  checkProductRows,
  customerNameKey,
  mapHeaders,
  productNameKey,
  type CheckedRow,
  type CustomerInsert,
  type ProductInsert,
} from '@/lib/import/validate-rows';

/**
 * Feature D: the two halves of an import, split so the slow part never runs while a lock is held.
 *  1. readAndMap: decode + parse + header mapping. No database, no lock.
 *  2. checkAgainstAccount: duplicates + tax-rate lookup + row checks. Runs on whatever executor it is given
 *     (a plain read for "check", the locked import transaction for "run"), so the run re-checks against the
 *     account exactly as it is at write time and never trusts an earlier preview.
 */
type Executor = Pick<DbTransaction, 'select'>;

export type ParsedImport =
  | { readonly ok: true; readonly kind: 'customers'; readonly rows: readonly SheetRow[]; readonly indexOf: ReadonlyMap<CustomerColumnKey, number> }
  | { readonly ok: true; readonly kind: 'products'; readonly rows: readonly SheetRow[]; readonly indexOf: ReadonlyMap<ProductColumnKey, number> }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function readAndMap(input: { kind: ImportKind; fileName: string; base64: string }): Promise<ParsedImport> {
  const sheet = await readImportFile({ fileName: input.fileName, base64: input.base64 });
  if (!sheet.ok) return { ok: false, code: sheet.code, message: sheet.message };
  if (input.kind === 'customers') {
    const mapped = mapHeaders(sheet.header, CUSTOMER_COLUMNS);
    if (!mapped.ok) return { ok: false, code: 'MISSING_COLUMNS', message: mapped.message };
    return { ok: true, kind: 'customers', rows: sheet.rows, indexOf: mapped.indexOf };
  }
  const mapped = mapHeaders(sheet.header, PRODUCT_COLUMNS);
  if (!mapped.ok) return { ok: false, code: 'MISSING_COLUMNS', message: mapped.message };
  return { ok: true, kind: 'products', rows: sheet.rows, indexOf: mapped.indexOf };
}

/** Active GST rates valid today, keyed by their "18.00"-style percentage. The newest row wins on a tie. */
export async function loadTaxRateIdsByPercent(executor: Executor, today: Date = new Date()): Promise<Map<string, string>> {
  const day = formatIstDateAsIso(today);
  const rows = await executor
    .select({ id: taxRates.id, rate: taxRates.rate_percentage })
    .from(taxRates)
    .where(
      and(
        eq(taxRates.is_active, true),
        lte(taxRates.effective_from, day),
        or(isNull(taxRates.effective_to), gte(taxRates.effective_to, day)),
      ),
    )
    .orderBy(desc(taxRates.effective_from));
  const byPercent = new Map<string, string>();
  for (const row of rows) {
    const key = Number(row.rate).toFixed(2);
    if (!byPercent.has(key)) byPercent.set(key, row.id);
  }
  return byPercent;
}

export type CheckedImport =
  | { readonly kind: 'customers'; readonly rows: readonly CheckedRow<CustomerInsert>[] }
  | { readonly kind: 'products'; readonly rows: readonly CheckedRow<ProductInsert>[] };

export async function checkAgainstAccount(
  executor: Executor,
  businessId: string,
  parsed: Extract<ParsedImport, { ok: true }>,
): Promise<CheckedImport> {
  if (parsed.kind === 'customers') {
    const existing = await executor
      .select({ name: customers.name, gstin: customers.gstin })
      .from(customers)
      .where(eq(customers.business_id, businessId));
    const gstins = new Set(existing.flatMap((row) => (row.gstin ? [row.gstin.toUpperCase()] : [])));
    const unregisteredNames = new Set(existing.flatMap((row) => (row.gstin ? [] : [customerNameKey(row.name)])));
    return { kind: 'customers', rows: checkCustomerRows(parsed.rows, parsed.indexOf, gstins, unregisteredNames) };
  }
  const [existing, rates] = await Promise.all([
    executor.select({ name: products.name }).from(products).where(eq(products.business_id, businessId)),
    loadTaxRateIdsByPercent(executor),
  ]);
  const names = new Set(existing.map((row) => productNameKey(row.name)));
  return { kind: 'products', rows: checkProductRows(parsed.rows, parsed.indexOf, names, rates) };
}

export interface ImportSummary {
  readonly total: number;
  readonly ready: number;
  readonly duplicates: number;
  readonly errors: number;
}

export function summarise(rows: readonly { status: 'ready' | 'duplicate' | 'error' }[]): ImportSummary {
  return {
    total: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    errors: rows.filter((row) => row.status === 'error').length,
  };
}
