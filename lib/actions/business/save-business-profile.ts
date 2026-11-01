'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { businessProfileSchema } from '@/lib/validations/business';
import { db } from '@/lib/db/client';
import { businesses, financialYears, users } from '@/lib/db/schema';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { DEFAULT_INVOICE_TEMPLATE_ID } from '@/lib/invoices/template-ids';
import { checkInvoiceSettingsEntitlement } from '@/lib/subscriptions/invoice-settings-gate';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

const DEFAULT_INVOICE_NUMBER_FORMAT = 'BMA/{FY}/{SEQ:4}';
const DEFAULT_CREDIT_NOTE_PREFIX = 'CN';
const DEFAULT_PAYMENT_DUE_DAYS = 30;
const TRIAL_DURATION_DAYS = 14;
const DEFAULT_INVOICE_TERMS = '1. Goods once sold will not be taken back.\n2. Payment to be made within 30 days from the date of invoice.\n3. Interest @ 24% per annum will be charged on overdue invoices until payment is received.';

export const saveBusinessProfile = createAuthenticatedAction(businessProfileSchema, async (input, context) => {
  const profileData = {
    legal_name: input.legal_name,
    trade_name: input.trade_name || null,
    gstin: input.gstin,
    pan: input.pan || null,
    registration_type: input.registration_type,
    address_line1: input.address_line1,
    address_line2: input.address_line2 || null,
    city: input.city,
    state_code: input.state_code,
    pincode: input.pincode,
    phone: input.phone || null,
    email: input.email || null,
    bank_account_name: input.bank_account_name || null,
    bank_account_number: input.bank_account_number || null,
    bank_ifsc: input.bank_ifsc || null,
    bank_name: input.bank_name || null,
    nature_of_business: input.nature_of_business || null,
    alternate_phone: input.alternate_phone || null,
  };

  const existingBusinessId = context.appUser.business_id;

  let savedBusinessId: string;
  try {
    savedBusinessId = await db.transaction(async (tx): Promise<string> => {
      if (existingBusinessId) {
        // EDIT: profile fields ONLY. Invoice settings (number format, credit-note prefix, terms, due days,
        // default template, default GST mode) are owned by saveInvoiceSettings, which enforces plan gating.
        // Any such keys in the payload are deliberately ignored (stale clients may still send old defaults).
        await tx.update(businesses)
          .set({ ...profileData, updated_at: new Date() })
          .where(eq(businesses.id, existingBusinessId));
        return existingBusinessId;
      }

      // FIRST-TIME SETUP: evaluate the entitlement gate against the exact subscription state we are inserting.
      const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const subscription = {
        subscription_plan: 'trial' as const,
        subscription_status: 'trial' as const,
        trial_ends_at: trialEndsAt,
      };
      const invoiceNumberFormat = input.invoice_number_format || DEFAULT_INVOICE_NUMBER_FORMAT;
      const defaultInvoiceTemplate = input.default_invoice_template ?? DEFAULT_INVOICE_TEMPLATE_ID;

      const gate = checkInvoiceSettingsEntitlement(subscription, null, {
        invoice_number_format: invoiceNumberFormat,
        default_invoice_template: defaultInvoiceTemplate,
      });
      if (!gate.allowed) throw new ActionError(gate.message, { code: gate.code }); // rolls the transaction back

      const [newBusiness] = await tx.insert(businesses).values({
        ...profileData,
        invoice_number_format: invoiceNumberFormat,
        credit_note_number_prefix: input.credit_note_number_prefix || DEFAULT_CREDIT_NOTE_PREFIX,
        invoice_terms: input.invoice_terms || DEFAULT_INVOICE_TERMS,
        payment_due_days: input.payment_due_days ?? DEFAULT_PAYMENT_DUE_DAYS,
        default_invoice_template: defaultInvoiceTemplate,
        default_gst_rate_type: input.default_gst_rate_type ?? 'exclusive',
        subscription_plan: subscription.subscription_plan,
        subscription_status: subscription.subscription_status,
        trial_ends_at: trialEndsAt,
      }).returning({ id: businesses.id });
      if (!newBusiness) throw new ActionError('We could not create your business profile. Please try again.', { code: 'TRANSACTION_FAILED' });

      const currentFY = getIndianFinancialYearForDate(new Date());

      await tx.insert(financialYears).values({
        business_id: newBusiness.id,
        label: currentFY.label,
        start_date: currentFY.startDate.toISOString(),
        end_date: currentFY.endDate.toISOString(),
        is_current: true,
        invoice_sequence_counter: 0,
        credit_note_sequence_counter: 0,
      });

      await tx.update(users)
        .set({ business_id: newBusiness.id })
        .where(eq(users.id, context.appUser.id));

      return newBusiness.id;
    });
  } catch (error: unknown) {
    if (error instanceof ActionError) throw error; // entitlement / expected errors keep their message + code
    logError('save-business-profile', error);
    throw new ActionError('We could not save your business profile. Please try again.', { code: 'TRANSACTION_FAILED' });
  }

  revalidatePath('/settings');
  revalidatePath('/invoices/new');
  revalidatePath('/invoices');

  return { businessId: savedBusinessId };
}, 'save-business-profile');
