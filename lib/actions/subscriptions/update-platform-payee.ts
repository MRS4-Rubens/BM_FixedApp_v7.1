'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { db } from '@/lib/db/client';
import { platformSettings, platformSettingsHistory } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';
import { updatePlatformPayeeSchema } from '@/lib/validations/admin-payee';
import { validatePayeeObject, describePayeeProblems } from '@/lib/config/payee';
import { eq } from 'drizzle-orm';

export const updatePlatformPayeeAction = createAuthenticatedAction(
  updatePlatformPayeeSchema,
  async (input, context) => {
    const check = validatePayeeObject(input);
    if (check.status !== 'configured') {
      throw new ActionError(
        `These payee details cannot be used: ${describePayeeProblems(check.problems)}`,
        { code: 'PAYEE_INVALID' }
      );
    }

    const now = new Date();
    try {
      const requestContext = await getAuditRequestContext();
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, 'payee_config'))
          .for('update');

        await tx
          .insert(platformSettings)
          .values({
            key: 'payee_config',
            value: check.config,
            updated_by: context.appUser.id,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: {
              value: check.config,
              updated_by: context.appUser.id,
              updated_at: now,
            },
          });

        await tx.insert(platformSettingsHistory).values({
          key: 'payee_config',
          old_value: existing?.value ?? null,
          new_value: check.config,
          changed_by: context.appUser.id,
          changed_by_email: context.appUser.email ?? null,
          request_context: requestContext,
        });
      });

      revalidatePath('/admin');
      revalidatePath('/checkout');

      return {
        message: 'Payee settings successfully updated.',
      };
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      logError('update-platform-payee', err);
      throw new ActionError('Failed to save payee configuration. Please try again.', {
        code: 'DB_UPDATE_FAILED',
      });
    }
  },
  'update-platform-payee',
  { requirePlatformAdmin: true }
);
