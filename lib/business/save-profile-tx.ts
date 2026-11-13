import type { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ActionError } from '@/lib/actions/_shared/errors';
import {
  evaluateRoleAccess,
  OWNER_ONLY,
  FORBIDDEN_ROLE_CODE,
  FORBIDDEN_ROLE_MESSAGE,
} from '@/lib/auth/rbac';
import { writeAudit, type AuditRequestContext, NO_AUDIT_REQUEST_CONTEXT } from '@/lib/audit/log';
import { buildProfileAuditChanges } from '@/lib/audit/profile-diff';
import { SUPPORT_EMAIL } from '@/lib/config/contact';
import type { DbTransaction } from '@/lib/db/client';
import { businesses, financialYears, users } from '@/lib/db/schema';
import { setLocalLockTimeout } from '@/lib/db/transaction';
import { getIndianFinancialYearForDate } from '@/lib/invoices/financial-year';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { DEFAULT_INVOICE_TEMPLATE_ID } from '@/lib/invoices/template-ids';
import { checkInvoiceSettingsEntitlement } from '@/lib/subscriptions/invoice-settings-gate';
import type { businessProfileSchema } from '@/lib/validations/business';
import { normaliseInvoiceTagline } from '@/lib/business/invoice-tagline';
import { diffBusinessIdentity, buildIdentityLockedMessage } from './identity-policy';
import { hasFinalizedInvoices } from './identity-lock';

const DEFAULT_INVOICE_NUMBER_FORMAT = 'BMA/{FY}/{SEQ:4}';
const DEFAULT_CREDIT_NOTE_PREFIX = 'CN';
const DEFAULT_PAYMENT_DUE_DAYS = 30;
import { TRIAL_DURATION_DAYS } from '@/lib/subscriptions/entitlements';
const DEFAULT_INVOICE_TERMS =
  '1. Goods once sold will not be taken back.\n2. Payment to be made within 30 days from the date of invoice.\n3. Interest @ 24% per annum will be charged on overdue invoices until payment is received.';

export interface SaveProfileTxParams {
  readonly userId: string; // app users.id (NOT auth id)
  readonly profile: z.infer<typeof businessProfileSchema>;
  readonly now?: Date;
  readonly requestContext?: AuditRequestContext;
}

export interface SaveProfileTxResult {
  readonly businessId: string;
  readonly mode: 'created' | 'updated';
}

export async function saveBusinessProfileInTransaction(
  tx: DbTransaction,
  params: SaveProfileTxParams,
): Promise<SaveProfileTxResult> {
  // 1. Set lock timeout
  await setLocalLockTimeout(tx);

  const now = params.now ?? new Date();
  const requestContext = params.requestContext ?? NO_AUDIT_REQUEST_CONTEXT;

  // 2. Lock the user row and read authoritative state
  const [user] = await tx
    .select({ id: users.id, business_id: users.business_id, role: users.role })
    .from(users)
    .where(eq(users.id, params.userId))
    .for('update');

  if (!user) {
    throw new ActionError('Your account could not be found. Please sign in again.', { code: 'NO_APP_USER' });
  }

  // 3. Build profileData
  const profileData = {
    legal_name: params.profile.legal_name,
    trade_name: params.profile.trade_name || null,
    gstin: params.profile.gstin,
    pan: params.profile.pan || null,
    registration_type: params.profile.registration_type,
    address_line1: params.profile.address_line1,
    address_line2: params.profile.address_line2 || null,
    city: params.profile.city,
    state_code: params.profile.state_code,
    pincode: params.profile.pincode,
    phone: params.profile.phone || null,
    email: params.profile.email || null,
    bank_account_name: params.profile.bank_account_name || null,
    bank_account_number: params.profile.bank_account_number || null,
    bank_ifsc: params.profile.bank_ifsc || null,
    bank_name: params.profile.bank_name || null,
    nature_of_business: params.profile.nature_of_business || null,
    invoice_tagline: normaliseInvoiceTagline(params.profile.invoice_tagline),
    alternate_phone: params.profile.alternate_phone || null,
  };

  // 4. If user.business_id === null -> CREATE
  if (user.business_id === null) {
    const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const subscription = {
      subscription_plan: 'trial' as const,
      subscription_status: 'trial' as const,
      trial_ends_at: trialEndsAt,
    };

    const invoiceNumberFormat = params.profile.invoice_number_format || DEFAULT_INVOICE_NUMBER_FORMAT;
    const defaultInvoiceTemplate = params.profile.default_invoice_template ?? DEFAULT_INVOICE_TEMPLATE_ID;

    const gate = checkInvoiceSettingsEntitlement(subscription, null, {
      invoice_number_format: invoiceNumberFormat,
      default_invoice_template: defaultInvoiceTemplate,
    });
    if (!gate.allowed) {
      throw new ActionError(gate.message, { code: gate.code });
    }

    const [newBusiness] = await tx
      .insert(businesses)
      .values({
        ...profileData,
        invoice_number_format: invoiceNumberFormat,
        credit_note_number_prefix: params.profile.credit_note_number_prefix || DEFAULT_CREDIT_NOTE_PREFIX,
        invoice_terms: params.profile.invoice_terms || DEFAULT_INVOICE_TERMS,
        payment_due_days: params.profile.payment_due_days ?? DEFAULT_PAYMENT_DUE_DAYS,
        default_invoice_template: defaultInvoiceTemplate,
        default_gst_rate_type: params.profile.default_gst_rate_type ?? 'exclusive',
        subscription_plan: subscription.subscription_plan,
        subscription_status: subscription.subscription_status,
        trial_ends_at: trialEndsAt,
      })
      .returning({ id: businesses.id });

    if (!newBusiness) {
      throw new ActionError('We could not create your business profile. Please try again.', {
        code: 'TRANSACTION_FAILED',
      });
    }

    const currentFY = getIndianFinancialYearForDate(now);

    await tx.insert(financialYears).values({
      business_id: newBusiness.id,
      label: currentFY.label,
      start_date: formatIstDateAsIso(currentFY.startDate),
      end_date: formatIstDateAsIso(currentFY.endDate),
      invoice_sequence_counter: 0,
      credit_note_sequence_counter: 0,
    });

    await tx
      .update(users)
      .set({ business_id: newBusiness.id, updated_at: now })
      .where(eq(users.id, user.id));

    await writeAudit(tx, {
      businessId: newBusiness.id,
      actorUserId: user.id,
      entityType: 'business',
      entityId: newBusiness.id,
      action: 'profile_create',
      requestContext,
      metadata: {
        gstin: params.profile.gstin,
        legal_name: params.profile.legal_name,
        state_code: params.profile.state_code,
        registration_type: params.profile.registration_type,
      },
    });

    return { businessId: newBusiness.id, mode: 'created' };
  }

  // 5. UPDATE the existing business
  if (!evaluateRoleAccess(user.role, OWNER_ONLY).allowed) {
    throw new ActionError(FORBIDDEN_ROLE_MESSAGE, { code: FORBIDDEN_ROLE_CODE });
  }

  const [current] = await tx
    .select({
      id: businesses.id,
      gstin: businesses.gstin,
      state_code: businesses.state_code,
      legal_name: businesses.legal_name,
      trade_name: businesses.trade_name,
      registration_type: businesses.registration_type,
      bank_account_name: businesses.bank_account_name,
      bank_ifsc: businesses.bank_ifsc,
      bank_name: businesses.bank_name,
      pan: businesses.pan,
      address_line1: businesses.address_line1,
      address_line2: businesses.address_line2,
      city: businesses.city,
      pincode: businesses.pincode,
      phone: businesses.phone,
      email: businesses.email,
      alternate_phone: businesses.alternate_phone,
      nature_of_business: businesses.nature_of_business,
      invoice_tagline: businesses.invoice_tagline,
      bank_account_number: businesses.bank_account_number,
    })
    .from(businesses)
    .where(eq(businesses.id, user.business_id))
    .for('update');

  if (!current) {
    throw new ActionError('Business profile not found.', { code: 'NOT_FOUND' });
  }

  const businessId = user.business_id;
  const change = diffBusinessIdentity(current, {
    gstin: params.profile.gstin,
    state_code: params.profile.state_code,
  });

  if (change.kind === 'changed') {
    if (await hasFinalizedInvoices(tx, businessId)) {
      const lockedMessage = buildIdentityLockedMessage(SUPPORT_EMAIL);
      throw new ActionError(lockedMessage, {
        code: 'IDENTITY_LOCKED',
        fieldErrors: Object.fromEntries(
          change.fields.map((f) => [f, [lockedMessage]]),
        ),
      });
    }
  }

  await tx
    .update(businesses)
    .set({ ...profileData, updated_at: now })
    .where(eq(businesses.id, businessId));

  if (change.kind === 'changed') {
    await writeAudit(tx, {
      businessId,
      actorUserId: user.id,
      entityType: 'business',
      entityId: businessId,
      action: 'business_identity_changed',
      requestContext,
      metadata: {
        source: 'owner_profile_edit',
        fields: change.fields,
        previous: { gstin: current.gstin, state_code: current.state_code },
        next: { gstin: params.profile.gstin, state_code: params.profile.state_code },
      },
    });
  } else {
    const audited = buildProfileAuditChanges(current, profileData);
    if (audited) {
      await writeAudit(tx, {
        businessId,
        actorUserId: user.id,
        entityType: 'business',
        entityId: businessId,
        action: 'profile_update',
        requestContext,
        metadata: { changed_fields: audited.changed_fields, changes: audited.changes },
      });
    }
  }

  return { businessId, mode: 'updated' };
}

