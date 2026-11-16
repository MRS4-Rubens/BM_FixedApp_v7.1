'use server';

import { count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { lockBusinessRow } from '@/lib/actions/_shared/business-lock';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { setLocalLockTimeout, withTransactionRetry } from '@/lib/db/transaction';
import { customers, products } from '@/lib/db/schema';
import { exportLimiter } from '@/lib/rate-limit/upstash';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { bulkImportSchema } from '@/lib/validations/bulk-import';
import { assertCanImport } from '@/lib/import/entitlement';
import { checkAgainstAccount, readAndMap, summarise, type ImportSummary } from '@/lib/import/prepare';

const INSERT_CHUNK = 250;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Feature D, step 2 of 2: import every READY row of the file in ONE transaction.
 * - The file is parsed again here (never trust the preview); the slow parse happens BEFORE the lock.
 * - Under the business row lock: plan check, duplicate check against the account as it is now, quota check,
 *   then all inserts. Any failure rolls everything back: nothing is ever half-imported.
 * - Duplicate and invalid rows are skipped and reported; at least one ready row is required.
 */
export const runBulkImport = createAuthenticatedAction(
  bulkImportSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Set up your business profile before importing.', { code: 'NO_BUSINESS' });
    }

    const parsed = await readAndMap({ kind: input.kind, fileName: input.file_name, base64: input.file_base64 });
    if (!parsed.ok) {
      throw new ActionError(parsed.message, { code: parsed.code });
    }
    const requestContext = await getAuditRequestContext();

    let result: { summary: ImportSummary; imported: number };
    try {
      result = await withTransactionRetry(() =>
        db.transaction(async (tx) => {
          await setLocalLockTimeout(tx);
          const business = await lockBusinessRow(tx, businessId);
          assertCanImport(business);

          const checked = await checkAgainstAccount(tx, businessId, parsed);
          const summary = summarise(checked.rows);
          if (summary.ready === 0) {
            throw new ActionError('There are no new, valid rows to import. Fix the errors shown and try again.', {
              code: 'NOTHING_TO_IMPORT',
            });
          }

          const entitlements = getPlanEntitlements(business);
          if (checked.kind === 'customers') {
            const values = checked.rows.flatMap((row) => (row.status === 'ready' && row.value ? [{ ...row.value, business_id: businessId }] : []));
            if (entitlements.customerLimit !== null) {
              const [existing] = await tx.select({ n: count() }).from(customers).where(eq(customers.business_id, businessId));
              if ((existing?.n ?? 0) + values.length > entitlements.customerLimit) {
                throw new ActionError(`This import would go over your plan's limit of ${entitlements.customerLimit} customers.`, {
                  code: 'CUSTOMER_QUOTA_EXCEEDED',
                });
              }
            }
            for (const batch of chunks(values, INSERT_CHUNK)) {
              await tx.insert(customers).values(batch);
            }
            await writeAudit(tx, {
              businessId,
              actorUserId: context.appUser.id,
              entityType: 'business',
              entityId: businessId,
              action: 'customers_imported',
              requestContext,
              metadata: { file_name: input.file_name, imported: values.length, skipped_duplicates: summary.duplicates, skipped_errors: summary.errors },
            });
            return { summary, imported: values.length };
          }

          const values = checked.rows.flatMap((row) => (row.status === 'ready' && row.value ? [{ ...row.value, business_id: businessId }] : []));
          if (entitlements.productLimit !== null) {
            const [existing] = await tx.select({ n: count() }).from(products).where(eq(products.business_id, businessId));
            if ((existing?.n ?? 0) + values.length > entitlements.productLimit) {
              throw new ActionError(`This import would go over your plan's limit of ${entitlements.productLimit} products.`, {
                code: 'PRODUCT_QUOTA_EXCEEDED',
              });
            }
          }
          for (const batch of chunks(values, INSERT_CHUNK)) {
            await tx.insert(products).values(batch);
          }
          await writeAudit(tx, {
            businessId,
            actorUserId: context.appUser.id,
            entityType: 'business',
            entityId: businessId,
            action: 'products_imported',
            requestContext,
            metadata: { file_name: input.file_name, imported: values.length, skipped_duplicates: summary.duplicates, skipped_errors: summary.errors },
          });
          return { summary, imported: values.length };
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ActionError) throw error;
      throw toThrowable(error);
    }

    revalidatePath(input.kind === 'customers' ? '/customers' : '/products');
    return { kind: input.kind, summary: result.summary, imported: result.imported };
  },
  'run-bulk-import',
  {
    roles: EDITOR_ROLES,
    requireActiveSubscription: true,
    rateLimit: { limiter: exportLimiter, keyPrefix: 'bulk-import-run', outage: 'fail-closed' },
  },
);
