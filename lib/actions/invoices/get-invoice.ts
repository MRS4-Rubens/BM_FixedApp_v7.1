'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ActionError } from '@/lib/actions/_shared/errors';
import { findOwnedCustomer } from '@/lib/actions/_shared/ownership';

export const getInvoice = createAuthenticatedAction(z.object({ id: z.string().uuid() }), async ({ id }, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) throw new ActionError('No business linked.', { code: 'NO_BUSINESS' });

  const existing = await db.select().from(invoices).where(eq(invoices.id, id));
  // Same message and code for 'missing' and 'another business' so the response never reveals that an id exists.
  if (existing.length === 0) throw new ActionError('Invoice not found.', { code: 'NOT_FOUND' });
  
  const invoice = existing[0];
  if (invoice.business_id !== businessId) throw new ActionError('Invoice not found.', { code: 'NOT_FOUND' });

  // Tenant isolation (API-001): never return a customer row that belongs to another business.
  const customer = invoice.customer_id ? await findOwnedCustomer(db, businessId, invoice.customer_id) : null;

  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, id)).orderBy(invoiceLineItems.sort_order);

  return {
    ...invoice,
    customer,
    lineItems
  };
}, 'get-invoice');
