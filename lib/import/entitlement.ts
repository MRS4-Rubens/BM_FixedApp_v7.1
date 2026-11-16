import { ActionError } from '@/lib/actions/_shared/errors';
import { getPlanEntitlements, type BusinessSubscriptionSource } from '@/lib/subscriptions/entitlements';

/** Feature D: bulk import is part of the Professional plan. */
export function assertCanImport(business: BusinessSubscriptionSource | null | undefined): void {
  if (!getPlanEntitlements(business).canImportData) {
    throw new ActionError('Bulk import of customers and products is part of the Professional plan.', {
      code: 'IMPORT_PLAN_REQUIRED',
    });
  }
}
