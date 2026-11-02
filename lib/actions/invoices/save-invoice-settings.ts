'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { invoiceSettingsSchema } from '@/lib/validations/invoice-settings';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { checkInvoiceSettingsEntitlement } from '@/lib/subscriptions/invoice-settings-gate';

export const saveInvoiceSettings = createAuthenticatedAction(
  invoiceSettingsSchema,
  async (input, context) => {
    const businessId = context.appUser.business_id;
    if (!businessId) {
      throw new ActionError(
        'Please complete your business profile before configuring invoice settings.',
        { code: 'NO_BUSINESS' }
      );
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (!business) {
      throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
    }

    const gate = checkInvoiceSettingsEntitlement(business, business.invoice_number_format, {
      invoice_number_format: input.invoice_number_format,
      default_invoice_template: input.default_invoice_template,
    });
    if (!gate.allowed) throw new ActionError(gate.message, { code: gate.code });

    await db
      .update(businesses)
      .set({
        invoice_number_format: input.invoice_number_format,
        credit_note_number_prefix: input.credit_note_number_prefix,
        payment_due_days: input.payment_due_days,
        default_invoice_template: input.default_invoice_template,
        default_gst_rate_type: input.default_gst_rate_type,
        invoice_terms: input.invoice_terms,
        updated_at: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath('/settings');
    revalidatePath('/invoices');
    revalidatePath('/invoices/new');
    revalidatePath('/credit-notes/new');

    return { success: true };
  },
  'save-invoice-settings',
  { requireActiveSubscription: true }
);
