'use server';

import { z } from 'zod';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { findOwnedCustomer } from '@/lib/actions/_shared/ownership';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { toLoggableError } from '@/lib/actions/_shared/action-error-mapping';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { invoices, businesses, payments, creditNotes } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getResend } from '@/lib/email/resend';
import { getEmailEnv } from '@/lib/env';
import PaymentReminderEmail from '@/lib/email/templates/payment-reminder-email';
import { revalidatePath } from 'next/cache';
import { formatPaiseAsInr } from '@/lib/money';
import { getDisplayInvoiceStatus } from '@/lib/invoices/status';
import { getIstDateParts } from '@/lib/invoices/ist-date';

const SendPaymentReminderSchema = z.object({
  invoiceId: z.string().uuid(),
});

export const sendPaymentReminder = createAuthenticatedAction(
  SendPaymentReminderSchema,
  async (input, { appUser }) => {
    if (!appUser.business_id) {
      throw new ActionError('User does not belong to a business.');
    }

    const { invoiceId } = input;

    // 1. Fetch invoice and verify business ownership
    const invoiceRecords = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.business_id, appUser.business_id)));

    if (invoiceRecords.length === 0) {
      throw new ActionError('Invoice not found or unauthorized.');
    }

    const invoice = invoiceRecords[0];

    // 2. Fetch active payments and active finalized credit notes to compute net balance accurately
    const [[{ totalPaid }], [{ totalCredited }]] = await Promise.all([
      db
        .select({
          totalPaid: sql<number>`coalesce(sum(${payments.amount_paise}), 0)::bigint`.mapWith(Number),
        })
        .from(payments)
        .where(and(eq(payments.invoice_id, invoice.id), eq(payments.status, 'active'))),
      db
        .select({
          totalCredited: sql<number>`coalesce(sum(${creditNotes.grand_total_paise}), 0)::bigint`.mapWith(Number),
        })
        .from(creditNotes)
        .where(
          and(
            eq(creditNotes.original_invoice_id, invoice.id),
            eq(creditNotes.lifecycle_status, 'finalized'),
            eq(creditNotes.status, 'active')
          )
        ),
    ]);

    const sumOfPayments = Number(totalPaid ?? 0);
    const sumOfCredits = Number(totalCredited ?? 0);
    const balancePaise = invoice.grand_total_paise - sumOfPayments - sumOfCredits;

    if (balancePaise <= 0) {
      throw new ActionError('This invoice has already been settled in full.', {
        code: 'ALREADY_PAID',
      });
    }

    // Verify overdue status
    const displayStatus = getDisplayInvoiceStatus({
      lifecycle_status: invoice.lifecycle_status as 'draft' | 'finalized',
      payment_status: invoice.payment_status as 'unpaid' | 'partially_paid' | 'paid' | 'overdue',
      due_date: invoice.due_date,
    });

    if (displayStatus !== 'overdue') {
      throw new ActionError('This invoice is not currently overdue.');
    }

    if (!invoice.due_date) {
      throw new ActionError('This invoice does not have a due date.');
    }

    // Compute days overdue
    const asOfParts = getIstDateParts(new Date());
    const today = new Date(asOfParts.year, asOfParts.month - 1, asOfParts.day);
    
    const dueStr = invoice.due_date;
    const parts = dueStr.split('T')[0].split('-');
    const dueDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    
    // Days diff
    const diffTime = Math.abs(today.getTime() - dueDate.getTime());
    const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // 3. Fetch customer email
    if (!invoice.customer_id) {
      throw new ActionError(
        'This is a retail/ad-hoc customer invoice with no email address on file.',
        { code: 'NO_CUSTOMER_EMAIL' }
      );
    }

    // Tenant isolation (API-001): never email a customer that belongs to another business.
    const customer = await findOwnedCustomer(db, appUser.business_id, invoice.customer_id);
    if (!customer) {
      throw new ActionError('Customer not found.');
    }

    if (!customer.email || customer.email.trim() === '') {
      throw new ActionError(
        'This customer does not have an email address on file. Add one in Customers before emailing an invoice.',
        { code: 'NO_CUSTOMER_EMAIL' }
      );
    }

    // 4. Fetch business profile
    const businessRecords = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, appUser.business_id));

    if (businessRecords.length === 0) {
      throw new ActionError('Business not found.');
    }

    const business = businessRecords[0];

    // 5. Call resend.emails.send()
    const dueDateStr = new Date(invoice.due_date).toLocaleDateString('en-IN');
    
    const EMAIL_SEND_FAILED_MESSAGE = 'We could not send the email. Please try again.';

    let providerError: unknown = null;
    try {
      const result = await getResend().emails.send({
        from: getEmailEnv().RESEND_FROM_EMAIL,
        to: customer.email,
        subject: `Payment Reminder: Invoice ${invoice.invoice_number} from ${business.legal_name}`,
        react: PaymentReminderEmail({
          businessName: business.legal_name,
          customerName: customer.name,
          invoiceNumber: invoice.invoice_number,
          dueDate: dueDateStr,
          daysOverdue: daysOverdue,
          amountDueFormatted: formatPaiseAsInr(balancePaise),
        }) as React.ReactElement,
      });
      providerError = result.error;
    } catch (error: unknown) {
      logError('send-payment-reminder', toLoggableError(error), { invoiceId: invoice.id });
      throw new ActionError(EMAIL_SEND_FAILED_MESSAGE, { code: 'EMAIL_SEND_FAILED' });
    }
    if (providerError !== null && providerError !== undefined) {
      logError('send-payment-reminder', toLoggableError(providerError), { invoiceId: invoice.id, stage: 'provider-rejected' });
      throw new ActionError(EMAIL_SEND_FAILED_MESSAGE, { code: 'EMAIL_SEND_FAILED' });
    }

    // 6. Update emailed_at and email_send_count
    await db
      .update(invoices)
      .set({
        emailed_at: new Date(),
        email_send_count: (invoice.email_send_count || 0) + 1,
      })
      .where(eq(invoices.id, invoice.id));

    revalidatePath(`/invoices/${invoice.id}`);
    
    return { success: true };
  },
  'send-payment-reminder',
  { rateLimit: { limiter: sensitiveActionLimiter, keyPrefix: 'email-invoice' } }
);
