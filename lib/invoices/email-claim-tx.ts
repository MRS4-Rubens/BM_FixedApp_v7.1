import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { findOwnedCustomer } from '@/lib/actions/_shared/ownership';
import type { DbTransaction } from '@/lib/db/client';
import { invoices } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import {
  evaluateCooldown,
  formatRetryAfter,
  computeDaysOverdue,
  INVOICE_EMAIL_COOLDOWN_SECONDS,
  REMINDER_COOLDOWN_SECONDS,
} from '@/lib/email/send-policy';
import { lockFinalizedInvoice } from '@/lib/invoices/document-locks';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { loadInvoiceBalance } from '@/lib/invoices/payment-status';
import { getDisplayInvoiceStatus } from '@/lib/invoices/status';

const CustomerEmailSchema = z.string().trim().email();

export interface InvoiceEmailClaim {
  readonly invoiceId: string;
  readonly businessId: string;
  readonly claimedAt: Date;
  readonly previousEmailedAt: Date | null;
  readonly invoiceNumber: string;
  readonly invoiceDate: string | null;
  readonly dueDate: string | null;
  readonly grandTotalPaise: number;
  readonly pdfStorageKey: string;
  readonly customer: { readonly name: string; readonly email: string };
}

export async function claimInvoiceEmailInTransaction(
  tx: DbTransaction,
  params: { readonly businessId: string; readonly invoiceId: string; readonly now?: Date },
): Promise<InvoiceEmailClaim> {
  const now = params.now ?? new Date();

  // 1. Fail-fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. Lock invoice row FOR UPDATE
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: params.invoiceId, businessId: params.businessId },
    {
      notFound: 'Invoice not found.',
      notFinalized: 'Only finalized invoices can be emailed.',
    },
  );

  // 3. Require PDF archived in storage
  if (invoice.archival_status !== 'archived' || !invoice.pdf_storage_key) {
    throw new ActionError(
      "This invoice's PDF is still being archived. Please try again in a moment.",
      { code: 'PDF_NOT_READY' },
    );
  }

  // 4. Require customer with email
  if (!invoice.customer_id) {
    throw new ActionError(
      'This is a retail/ad-hoc customer invoice with no email address on file.',
      { code: 'NO_CUSTOMER_EMAIL' },
    );
  }

  const customer = await findOwnedCustomer(tx, params.businessId, invoice.customer_id);
  if (!customer) {
    throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });
  }

  if (!customer.email || customer.email.trim() === '') {
    throw new ActionError(
      'This customer does not have an email address on file. Add one in Customers before emailing an invoice.',
      { code: 'NO_CUSTOMER_EMAIL' },
    );
  }

  // 5. Validate customer email format
  const parsedEmail = CustomerEmailSchema.safeParse(customer.email);
  if (!parsedEmail.success) {
    throw new ActionError(
      "The customer's e-mail address looks invalid. Please correct it in Customers.",
      { code: 'INVALID_CUSTOMER_EMAIL' },
    );
  }

  // 6. Cooldown check
  const cooldown = evaluateCooldown(invoice.emailed_at, now, INVOICE_EMAIL_COOLDOWN_SECONDS);
  if (!cooldown.allowed) {
    throw new ActionError(
      `This invoice was e-mailed moments ago. You can send it again in ${formatRetryAfter(cooldown.retryAfterSeconds)}.`,
      { code: 'COOLDOWN' },
    );
  }

  // 7. Atomic guarded claim
  const updated = await tx
    .update(invoices)
    .set({
      emailed_at: now,
      email_send_count: sql`${invoices.email_send_count} + 1`,
    })
    .where(
      and(
        eq(invoices.id, invoice.id),
        eq(invoices.business_id, params.businessId),
        eq(invoices.lifecycle_status, 'finalized'),
      ),
    )
    .returning({ id: invoices.id });

  if (updated.length !== 1) {
    throw new ActionError('This invoice changed while sending. Please refresh and try again.', {
      code: 'CONFLICT',
    });
  }

  return {
    invoiceId: invoice.id,
    businessId: params.businessId,
    claimedAt: now,
    previousEmailedAt: invoice.emailed_at,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    grandTotalPaise: invoice.grand_total_paise,
    pdfStorageKey: invoice.pdf_storage_key,
    customer: {
      name: customer.name,
      email: parsedEmail.data,
    },
  };
}

export async function releaseInvoiceEmailClaim(
  executor: Pick<DbTransaction, 'update'>,
  claim: InvoiceEmailClaim,
): Promise<void> {
  try {
    await executor
      .update(invoices)
      .set({
        emailed_at: claim.previousEmailedAt,
        email_send_count: sql`greatest(${invoices.email_send_count} - 1, 0)`,
      })
      .where(
        and(
          eq(invoices.id, claim.invoiceId),
          eq(invoices.business_id, claim.businessId),
          eq(invoices.emailed_at, claim.claimedAt),
        ),
      );
  } catch (error: unknown) {
    logError('release-invoice-email-claim', error, { invoiceId: claim.invoiceId });
  }
}

export interface ReminderClaim {
  readonly invoiceId: string;
  readonly businessId: string;
  readonly claimedAt: Date;
  readonly previousLastReminderAt: Date | null;
  readonly invoiceNumber: string;
  readonly dueDate: string;
  readonly daysOverdue: number;
  readonly balanceDuePaise: number;
  readonly customer: { readonly name: string; readonly email: string };
}

export async function claimReminderInTransaction(
  tx: DbTransaction,
  params: {
    readonly businessId: string;
    readonly invoiceId: string;
    readonly now?: Date;
    readonly todayIst?: string;
  },
): Promise<ReminderClaim> {
  const now = params.now ?? new Date();

  // 1. Fail-fast lock timeout
  await setLocalLockTimeout(tx);

  // 2. Lock invoice row FOR UPDATE
  const invoice = await lockFinalizedInvoice(
    tx,
    { id: params.invoiceId, businessId: params.businessId },
    {
      notFound: 'Invoice not found.',
      notFinalized: 'Payment reminders can only be sent for finalized invoices.',
    },
  );

  // 3. Balance verification via authoritative loadInvoiceBalance
  const balance = await loadInvoiceBalance(tx, invoice);
  if (balance.remainingPaise <= 0 || invoice.payment_status === 'paid') {
    throw new ActionError('This invoice has already been settled in full.', {
      code: 'ALREADY_PAID',
    });
  }

  // 4. Overdue check via getDisplayInvoiceStatus
  const displayStatus = getDisplayInvoiceStatus(
    {
      lifecycle_status: invoice.lifecycle_status as 'draft' | 'finalized',
      payment_status: invoice.payment_status as 'unpaid' | 'partially_paid' | 'paid' | 'overdue',
      due_date: invoice.due_date,
    },
    now,
  );

  if (displayStatus !== 'overdue') {
    throw new ActionError('This invoice is not currently overdue.', { code: 'NOT_OVERDUE' });
  }

  if (!invoice.due_date) {
    throw new ActionError('This invoice does not have a due date.');
  }

  const daysOverdue = computeDaysOverdue(
    invoice.due_date.slice(0, 10),
    params.todayIst ?? formatIstDateAsIso(now),
  );

  // 5. Require customer with email
  if (!invoice.customer_id) {
    throw new ActionError(
      'This is a retail/ad-hoc customer invoice with no email address on file.',
      { code: 'NO_CUSTOMER_EMAIL' },
    );
  }

  const customer = await findOwnedCustomer(tx, params.businessId, invoice.customer_id);
  if (!customer) {
    throw new ActionError('Customer not found.', { code: 'NOT_FOUND' });
  }

  if (!customer.email || customer.email.trim() === '') {
    throw new ActionError(
      'This customer does not have an email address on file. Add one in Customers before emailing an invoice.',
      { code: 'NO_CUSTOMER_EMAIL' },
    );
  }

  // 6. Validate customer email format
  const parsedEmail = CustomerEmailSchema.safeParse(customer.email);
  if (!parsedEmail.success) {
    throw new ActionError(
      "The customer's e-mail address looks invalid. Please correct it in Customers.",
      { code: 'INVALID_CUSTOMER_EMAIL' },
    );
  }

  // 7. Cooldown check
  const cooldown = evaluateCooldown(invoice.last_reminder_at, now, REMINDER_COOLDOWN_SECONDS);
  if (!cooldown.allowed) {
    throw new ActionError(
      `A reminder for this invoice was already sent. You can send another in ${formatRetryAfter(cooldown.retryAfterSeconds)}.`,
      { code: 'COOLDOWN' },
    );
  }

  // 8. Atomic guarded claim
  const updated = await tx
    .update(invoices)
    .set({
      last_reminder_at: now,
      reminder_count: sql`${invoices.reminder_count} + 1`,
    })
    .where(
      and(
        eq(invoices.id, invoice.id),
        eq(invoices.business_id, params.businessId),
        eq(invoices.lifecycle_status, 'finalized'),
      ),
    )
    .returning({ id: invoices.id });

  if (updated.length !== 1) {
    throw new ActionError('This invoice changed while sending. Please refresh and try again.', {
      code: 'CONFLICT',
    });
  }

  return {
    invoiceId: invoice.id,
    businessId: params.businessId,
    claimedAt: now,
    previousLastReminderAt: invoice.last_reminder_at,
    invoiceNumber: invoice.invoice_number,
    dueDate: invoice.due_date,
    daysOverdue,
    balanceDuePaise: balance.remainingPaise,
    customer: {
      name: customer.name,
      email: parsedEmail.data,
    },
  };
}

export async function releaseReminderClaim(
  executor: Pick<DbTransaction, 'update'>,
  claim: ReminderClaim,
): Promise<void> {
  try {
    await executor
      .update(invoices)
      .set({
        last_reminder_at: claim.previousLastReminderAt,
        reminder_count: sql`greatest(${invoices.reminder_count} - 1, 0)`,
      })
      .where(
        and(
          eq(invoices.id, claim.invoiceId),
          eq(invoices.business_id, claim.businessId),
          eq(invoices.last_reminder_at, claim.claimedAt),
        ),
      );
  } catch (error: unknown) {
    logError('release-reminder-claim', error, { invoiceId: claim.invoiceId });
  }
}
