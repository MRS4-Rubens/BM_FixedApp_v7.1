import { INVOICE_TEMPLATE_IDS } from '../invoices/template-ids';

/**
 * SINGLE SOURCE OF TRUTH (DB-004) for every closed set of text values stored in the database.
 * Consumed by: Drizzle CHECK constraints + $type<>() narrowing, Zod schemas, and type guards.
 * Adding or removing a value REQUIRES a new migration that replaces the matching CHECK constraint,
 * plus an update to tests/integration/db004-state-constraints.test.ts.
 * IMPORTANT: imported by lib/db/schema/*, which drizzle-kit loads WITHOUT the "@/" alias: relative imports only.
 */
export { INVOICE_TEMPLATE_IDS };
export type InvoiceTemplateValue = (typeof INVOICE_TEMPLATE_IDS)[number];

/** payments.kind: money received from the customer, or money given back to them (a refund). */
export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** payments.status and credit_notes.status */
export const RECORD_STATUSES = ['active', 'voided'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** businesses.subscription_plan and subscription_requests.plan_name */
export const SUBSCRIPTION_PLANS = ['trial', 'free', 'essentials', 'professional'] as const;
export type SubscriptionPlanValue = (typeof SUBSCRIPTION_PLANS)[number];

/** businesses.subscription_status */
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'expired', 'suspended'] as const;
export type SubscriptionStatusValue = (typeof SUBSCRIPTION_STATUSES)[number];

/** Plans a customer can actually pay for (claim flow). Subset of SUBSCRIPTION_PLANS. */
export const PAID_PLAN_NAMES = ['essentials', 'professional'] as const satisfies readonly SubscriptionPlanValue[];
export type PaidPlanValue = (typeof PAID_PLAN_NAMES)[number];

/** Billing cycles a customer can choose in the claim flow. */
export const CLAIM_BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type ClaimBillingCycle = (typeof CLAIM_BILLING_CYCLES)[number];

/** subscription_requests.billing_cycle also stores admin overrides. */
export const REQUEST_BILLING_CYCLES = [...CLAIM_BILLING_CYCLES, 'manual_override'] as const;
export type RequestBillingCycle = (typeof REQUEST_BILLING_CYCLES)[number];

/** Payment methods a customer can choose in the claim flow. */
export const CLAIM_PAYMENT_METHODS = ['upi_qr', 'upi_id', 'bank_transfer'] as const;
export type ClaimPaymentMethod = (typeof CLAIM_PAYMENT_METHODS)[number];

/** subscription_requests.payment_method also stores admin overrides. */
export const REQUEST_PAYMENT_METHODS = [...CLAIM_PAYMENT_METHODS, 'manual_override'] as const;
export type RequestPaymentMethod = (typeof REQUEST_PAYMENT_METHODS)[number];

/** subscription_requests.status */
export const REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** business_invitations.status. "Expired" is not stored: it is a pending invite whose expires_at has passed. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Roles an owner may invite someone into. Ownership is never granted by invite (no ownership transfer). */
export const INVITABLE_ROLES = ['staff', 'accountant'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Type guard: narrows an unknown value to a member of a readonly string tuple. No casts. */
export function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.some((candidate) => candidate === value);
}


/**
 * Feature C (notifications). notifications.kind: every kind of message the app can raise.
 * The kind decides the category (who receives it, which e-mail switch controls it); see lib/notifications/catalog.ts.
 */
export const NOTIFICATION_KINDS = [
  'invoices_overdue',
  'invoices_due_soon',
  'gst_return_due',
  'gst_frequency_missing',
  'fy_ending',
  'trial_ending',
  'plan_expiring',
  'plan_expired',
  'payment_approved',
  'payment_rejected',
  'member_joined',
  'role_changed',
  'pdf_archival_failed',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** notifications.category: the four groups a person can switch e-mails on/off for. */
export const NOTIFICATION_CATEGORIES = ['money', 'gst', 'account', 'team'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * notifications.email_state. 'skipped' = no e-mail wanted (switched off, digest off, or no address);
 * 'pending' = waiting to be sent; 'sending' = claimed by a sender (a stale claim is re-taken);
 * 'sent' = delivered to the e-mail provider; 'failed' = gave up after the retry limit.
 */
export const NOTIFICATION_EMAIL_STATES = ['skipped', 'pending', 'sending', 'sent', 'failed'] as const;
export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number];

/** businesses.gst_filing_frequency (NULL = not chosen yet). Drives the GST deadline reminders. */
export const GST_FILING_FREQUENCIES = ['monthly', 'quarterly', 'not_filing'] as const;
export type GstFilingFrequency = (typeof GST_FILING_FREQUENCIES)[number];
