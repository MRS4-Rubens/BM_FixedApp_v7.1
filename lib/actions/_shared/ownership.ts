import { and, eq, inArray } from 'drizzle-orm';

import { ActionError } from '@/lib/actions/_shared/errors';
import type { DbTransaction } from '@/lib/db/client';
import { customers, products } from '@/lib/db/schema';

/**
 * Tenant-isolation helpers (API-001).
 *
 * Every record an authenticated user references by id (a customer, a product ...) must be proven to belong to the
 * caller's own business BEFORE it is read, copied into a snapshot, emailed to, or linked. A foreign id and a
 * non-existent id are deliberately indistinguishable (same NOT_FOUND error) so ids cannot be probed.
 */

/** Anything that can run a SELECT: the shared `db` client or a transaction handle (`tx`). */
export type DbExecutor = Pick<DbTransaction, 'select'>;

export type OwnedCustomer = typeof customers.$inferSelect;

const CUSTOMER_NOT_FOUND_MESSAGE = 'Customer not found.';
const PRODUCT_NOT_FOUND_MESSAGE = 'One or more selected products were not found.';

/** Returns the customer only if it belongs to `businessId`; otherwise null. Never throws for "not mine". */
export async function findOwnedCustomer(
  executor: DbExecutor,
  businessId: string,
  customerId: string,
): Promise<OwnedCustomer | null> {
  const [row] = await executor
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.business_id, businessId)))
    .limit(1);
  return row ?? null;
}

/** Like {@link findOwnedCustomer} but throws a user-safe NOT_FOUND ActionError when the customer is not the caller's. */
export async function assertOwnedCustomer(
  executor: DbExecutor,
  businessId: string,
  customerId: string,
): Promise<OwnedCustomer> {
  const row = await findOwnedCustomer(executor, businessId, customerId);
  if (!row) {
    throw new ActionError(CUSTOMER_NOT_FOUND_MESSAGE, { code: 'NOT_FOUND' });
  }
  return row;
}

/**
 * Asserts that EVERY given product id belongs to `businessId`. Empty values (null, undefined, '') are ignored
 * (ad-hoc line items have no product) and duplicates are allowed. Throws NOT_FOUND if any id is foreign/unknown.
 */
export async function assertOwnedProducts(
  executor: DbExecutor,
  businessId: string,
  productIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const uniqueIds = [
    ...new Set(productIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];
  if (uniqueIds.length === 0) {
    return;
  }
  const owned = await executor
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.business_id, businessId), inArray(products.id, uniqueIds)));
  if (owned.length !== uniqueIds.length) {
    throw new ActionError(PRODUCT_NOT_FOUND_MESSAGE, { code: 'NOT_FOUND' });
  }
}
