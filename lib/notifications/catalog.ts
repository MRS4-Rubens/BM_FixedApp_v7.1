import type { AppRole } from '@/lib/auth/rbac';
import type { NotificationCategory, NotificationKind } from '@/lib/db/domain-values';

/**
 * Feature C: what each kind of notification is about. CLIENT-SAFE (no server imports).
 * The category decides who receives it (CATEGORY_ROLES) and which e-mail switch controls it.
 */
export const NOTIFICATION_KIND_CATEGORY: Readonly<Record<NotificationKind, NotificationCategory>> = {
  invoices_overdue: 'money',
  invoices_due_soon: 'money',
  gst_return_due: 'gst',
  gst_frequency_missing: 'gst',
  fy_ending: 'gst',
  trial_ending: 'account',
  plan_expiring: 'account',
  plan_expired: 'account',
  payment_approved: 'account',
  payment_rejected: 'account',
  member_joined: 'team',
  role_changed: 'team',
  pdf_archival_failed: 'account',
};

/**
 * Approved decision: owner gets everything; staff get money (plus items addressed to them personally);
 * the read-only accountant (CA) gets GST deadlines and money summaries. Plan/billing and team management are
 * owner-only. Items addressed to a specific person (e.g. "your role was changed") bypass this table.
 */
export const CATEGORY_ROLES: Readonly<Record<NotificationCategory, readonly AppRole[]>> = {
  money: ['owner', 'staff', 'accountant'],
  gst: ['owner', 'accountant'],
  account: ['owner'],
  team: ['owner'],
};

export const CATEGORY_LABELS: Readonly<Record<NotificationCategory, { readonly label: string; readonly description: string }>> = {
  money: {
    label: 'Money to collect',
    description: 'Invoices that became overdue, and invoices due in the next 3 days.',
  },
  gst: {
    label: 'GST deadlines',
    description: 'GSTR-1 and GSTR-3B due-date reminders, and the financial year-end note.',
  },
  account: {
    label: 'Plan and account',
    description: 'Trial and plan expiry, payment approvals, and problems the app could not fix on its own.',
  },
  team: {
    label: 'Team',
    description: 'Someone joined your business, or your own role was changed.',
  },
};

/** Which categories a role can ever receive (the settings screen shows only these switches). */
export function categoriesForRole(role: AppRole): NotificationCategory[] {
  const categories = (Object.keys(CATEGORY_ROLES) as NotificationCategory[]).filter((category) =>
    CATEGORY_ROLES[category].includes(role),
  );
  // Everyone can be told that their own role changed.
  if (!categories.includes('team')) categories.push('team');
  return categories;
}
