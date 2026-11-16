'use server'

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { CUSTOMER_MAPPINGS } from '@/lib/actions/_shared/pg-constraint-mappings';
import { customerSchema } from '@/lib/validations/customer';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const updateCustomerSchema = customerSchema.extend({
  id: z.string().uuid('Invalid customer ID'),
});

export const updateCustomer = createAuthenticatedAction(updateCustomerSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  
  if (!businessId) {
    throw new ActionError('Please complete your business profile in Settings before updating customers.', { code: 'NOT_FOUND' });
  }

  const { id, ...updateData } = input;

  const dataToUpdate = {
    name: updateData.name,
    gstin: updateData.gstin || null,
    email: updateData.email || null,
    phone: updateData.phone || null,
    address_line1: updateData.address_line1 || null,
    address_line2: updateData.address_line2 || null,
    city: updateData.city || null,
    state_code: updateData.state_code,
    pincode: updateData.pincode || null,
    updated_at: new Date(),
  };

  try {
    const result = await db.update(customers)
      .set(dataToUpdate)
      .where(and(eq(customers.id, id), eq(customers.business_id, businessId)))
      .returning({ id: customers.id });

    if (result.length === 0) {
      throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });
    }
  } catch (error: unknown) {
    throw toThrowable(error, CUSTOMER_MAPPINGS);
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${id}/edit`);

  return { success: true };
}, 'update-customer', { roles: EDITOR_ROLES, requireActiveSubscription: true });
