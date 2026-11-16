'use server';

import { eq } from 'drizzle-orm';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { exportLimiter } from '@/lib/rate-limit/upstash';
import { bulkImportSchema } from '@/lib/validations/bulk-import';
import { assertCanImport } from '@/lib/import/entitlement';
import { checkAgainstAccount, readAndMap, summarise } from '@/lib/import/prepare';

/**
 * Feature D, step 1 of 2: read the uploaded file and report, row by row, what an import would do.
 * Writes NOTHING. The import step re-reads and re-checks the file itself; this preview is never trusted.
 */
export const checkBulkImport = createAuthenticatedAction(
  bulkImportSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError('Set up your business profile before importing.', { code: 'NO_BUSINESS' });
    }
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    assertCanImport(business);

    const parsed = await readAndMap({ kind: input.kind, fileName: input.file_name, base64: input.file_base64 });
    if (!parsed.ok) {
      throw new ActionError(parsed.message, { code: parsed.code });
    }
    const checked = await checkAgainstAccount(db, businessId, parsed);
    return {
      kind: checked.kind,
      summary: summarise(checked.rows),
      // `value` (the insert payload) stays on the server.
      rows: checked.rows.map((row) => ({
        rowNumber: row.rowNumber,
        label: row.label,
        status: row.status,
        issues: row.issues,
      })),
    };
  },
  'check-bulk-import',
  {
    roles: EDITOR_ROLES,
    requireActiveSubscription: true,
    rateLimit: { limiter: exportLimiter, keyPrefix: 'bulk-import-check', outage: 'fail-closed' },
  },
);
