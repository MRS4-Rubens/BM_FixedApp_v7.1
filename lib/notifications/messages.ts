import type { NotificationKind } from '@/lib/db/domain-values';
import { formatPaiseAsInr } from '@/lib/money';
import { PLAN_CATALOG } from '@/lib/subscriptions/plan-catalog';
import type { PlanTier } from '@/lib/subscriptions/entitlements';
import { diffDaysIso, formatIsoDateShort } from './dates';
import type { GstDueItem } from './gst-calendar';

/**
 * Feature C: the wording of every notification, in one place. PURE (no I/O), so every message is unit-tested.
 * `dedupeKey` identifies the real-world event: creating the same draft twice can never tell a person twice.
 */
export interface NotificationDraft {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** In-app path starting with "/", or null. */
  readonly link: string | null;
  readonly dedupeKey: string;
  /** Urgent items are e-mailed at once instead of in the next daily summary. */
  readonly urgent: boolean;
}

const BILLING_LINK = '/settings?tab=billing';
export const NOTIFICATION_SETTINGS_LINK = '/settings?tab=notifications';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * `dayIso` is the day the invoices became overdue (the de-duplication key). `todayIso` is when the person reads it:
 * the same day normally, a later day when the daily job catches up on a day it missed (BUG-01).
 */
export function invoicesOverdueDraft(
  dayIso: string,
  count: number,
  amountPaise: number,
  todayIso: string = dayIso,
): NotificationDraft {
  const when = dayIso === todayIso ? 'today' : `on ${formatIsoDateShort(dayIso)}`;
  return {
    kind: 'invoices_overdue',
    title: `${plural(count, 'invoice', 'invoices')} became overdue ${when}`,
    body: `${formatPaiseAsInr(amountPaise)} is still to be collected on ${count === 1 ? 'it' : 'them'}. Open the overdue list to send reminders or record payments.`,
    link: '/invoices?status=overdue',
    dedupeKey: `invoices-overdue:${dayIso}`,
    urgent: false,
  };
}

/**
 * `dayIso` is the day this reminder belongs to (the de-duplication key) and `dueIso` the invoices' due date. The title
 * counts the days left from `todayIso`, so a reminder caught up after a missed day still reads true (BUG-01).
 */
export function invoicesDueSoonDraft(
  dayIso: string,
  dueIso: string,
  count: number,
  amountPaise: number,
  todayIso: string = dayIso,
): NotificationDraft {
  const daysLeft = diffDaysIso(todayIso, dueIso);
  const when = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  return {
    kind: 'invoices_due_soon',
    title: `${plural(count, 'invoice', 'invoices')} due ${when}`,
    body: `${formatPaiseAsInr(amountPaise)} falls due on ${formatIsoDateShort(dueIso)}. A gentle reminder now often gets you paid on time.`,
    link: '/invoices?status=sent',
    dedupeKey: `invoices-due-soon:${dayIso}`,
    urgent: false,
  };
}

export function gstReturnDueDraft(item: GstDueItem): NotificationDraft {
  return {
    kind: 'gst_return_due',
    title: `${item.returnName} for ${item.periodLabel} is due on ${formatIsoDateShort(item.dueDateIso)}`,
    body:
      item.returnName === 'GSTR-1'
        ? 'File it on the GST portal before the due date. Your GSTR-1 Excel export is ready on the Reports page.'
        : 'File it and pay any tax due before the due date to avoid the daily late fee and interest.',
    link: '/reports',
    dedupeKey: `gst:${item.returnName}:${item.periodKey}`,
    urgent: false,
  };
}

export function gstFrequencyMissingDraft(): NotificationDraft {
  return {
    kind: 'gst_frequency_missing',
    title: 'Turn on GST deadline reminders',
    body: 'Tell us whether you file GST returns monthly or quarterly, and we will remind you 3 days before each GSTR-1 and GSTR-3B due date.',
    link: NOTIFICATION_SETTINGS_LINK,
    dedupeKey: 'gst-frequency-missing',
    urgent: false,
  };
}

/** `fyLabel` is the ending year, e.g. "2026-27". */
export function fyEndingDraft(fyLabel: string): NotificationDraft {
  return {
    kind: 'fy_ending',
    title: `Financial year ${fyLabel} ends on 31 March`,
    body: 'From 1 April your invoice numbers restart from 1 for the new financial year. Finalise any pending invoices dated this year before then.',
    link: '/invoices?status=draft',
    dedupeKey: `fy-ending:${fyLabel}`,
    urgent: false,
  };
}

export function trialEndingDraft(endIso: string, daysLeft: 1 | 3): NotificationDraft {
  return {
    kind: 'trial_ending',
    title: daysLeft === 1 ? 'Your free trial ends tomorrow' : 'Your free trial ends in 3 days',
    body: `Your trial ends on ${formatIsoDateShort(endIso)}. Choose a plan to keep creating invoices without interruption.`,
    link: BILLING_LINK,
    dedupeKey: `trial-ending:${endIso}:d${daysLeft}`,
    urgent: daysLeft === 1,
  };
}

function planName(plan: PlanTier): string {
  return PLAN_CATALOG[plan].name;
}

export function planExpiringDraft(plan: PlanTier, endIso: string, daysLeft: 1 | 7): NotificationDraft {
  return {
    kind: 'plan_expiring',
    title: daysLeft === 1 ? `Your ${planName(plan)} plan expires tomorrow` : `Your ${planName(plan)} plan expires in 7 days`,
    body: `It is valid until ${formatIsoDateShort(endIso)}. Renew now so your team can keep billing without a break.`,
    link: BILLING_LINK,
    dedupeKey: `plan-expiring:${endIso}:d${daysLeft}`,
    urgent: daysLeft === 1,
  };
}

export function planExpiredDraft(wasTrial: boolean, endIso: string): NotificationDraft {
  return {
    kind: 'plan_expired',
    title: wasTrial ? 'Your free trial has ended' : 'Your plan has expired',
    body: 'You can still view, download and export everything, but you cannot create new invoices until you choose a plan.',
    link: BILLING_LINK,
    dedupeKey: `plan-expired:${endIso}`,
    urgent: false,
  };
}

export function paymentApprovedDraft(requestId: string, plan: PlanTier, endsAt: Date, formatDate: (d: Date) => string): NotificationDraft {
  return {
    kind: 'payment_approved',
    title: 'Your payment was approved',
    body: `Your ${planName(plan)} plan is active until ${formatDate(endsAt)}. Thank you!`,
    link: BILLING_LINK,
    dedupeKey: `payment:${requestId}`,
    urgent: true,
  };
}

export function paymentRejectedDraft(requestId: string, reason: string): NotificationDraft {
  const trimmed = reason.trim().slice(0, 500);
  return {
    kind: 'payment_rejected',
    title: 'Your payment claim was not approved',
    body: `Reason: ${trimmed} You can check the details and submit the payment again from Billing.`,
    link: BILLING_LINK,
    dedupeKey: `payment:${requestId}`,
    urgent: true,
  };
}

const ROLE_WORDS = { staff: 'Team member', accountant: 'Accountant (read-only)' } as const;

export function memberJoinedDraft(memberUserId: string, invitationId: string, who: string, role: 'staff' | 'accountant'): NotificationDraft {
  return {
    kind: 'member_joined',
    title: `${who.slice(0, 120)} joined your business`,
    body: `They accepted your invitation and joined as ${ROLE_WORDS[role]}.`,
    link: '/settings?tab=users',
    dedupeKey: `member-joined:${invitationId}:${memberUserId}`,
    urgent: false,
  };
}

export function roleChangedDraft(changeId: string, newRole: 'staff' | 'accountant'): NotificationDraft {
  return {
    kind: 'role_changed',
    title: `Your role was changed to ${ROLE_WORDS[newRole]}`,
    body:
      newRole === 'accountant'
        ? 'You can now view invoices, payments and reports and download exports, but you cannot change anything.'
        : 'You can now create invoices, record payments and manage customers and products.',
    link: '/dashboard',
    dedupeKey: `role-changed:${changeId}`,
    urgent: false,
  };
}

export function pdfArchivalFailedDraft(kind: 'invoice' | 'credit_note', documentId: string, documentNumber: string): NotificationDraft {
  const noun = kind === 'invoice' ? 'invoice' : 'credit note';
  return {
    kind: 'pdf_archival_failed',
    title: `The PDF copy of ${noun} ${documentNumber} could not be saved`,
    body: `We tried several times to store a permanent PDF copy of this ${noun}. The ${noun} itself is safe. Please contact support so we can fix it.`,
    link: kind === 'invoice' ? `/invoices/${documentId}` : `/credit-notes/${documentId}`,
    dedupeKey: `pdf-failed:${kind}:${documentId}`,
    urgent: false,
  };
}
