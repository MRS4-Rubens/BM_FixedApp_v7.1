import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { diffDaysIso, istTodayIso } from './dates';
import {
  planExpiredDraft,
  planExpiringDraft,
  trialEndingDraft,
  type NotificationDraft,
} from './messages';

/** How long after the end we still say "has expired" (covers a missed daily run or two). */
const EXPIRED_WINDOW_MS = 3 * 86_400_000;

export interface PlanReminderSource {
  readonly subscription_plan: string;
  readonly subscription_status: string;
  readonly trial_ends_at: Date | null;
  readonly subscription_ends_at: Date | null;
}

/**
 * Feature C: trial / plan reminders for one business on the given day. PURE.
 * Trial: 3 days before and the day before (urgent). Paid plan: 7 days before and the day before (urgent).
 * Both: "has ended/expired" once, within 3 days after the end. Suspended or admin-expired accounts get nothing here.
 */
export function planReminderDrafts(business: PlanReminderSource, now: Date): NotificationDraft[] {
  const todayIso = istTodayIso(now);

  if (business.subscription_status === 'trial' && business.trial_ends_at) {
    const end = business.trial_ends_at;
    const endIso = formatIstDateAsIso(end);
    if (end.getTime() <= now.getTime()) {
      return now.getTime() - end.getTime() < EXPIRED_WINDOW_MS ? [planExpiredDraft(true, endIso)] : [];
    }
    const daysLeft = diffDaysIso(todayIso, endIso);
    if (daysLeft === 3 || daysLeft === 1) return [trialEndingDraft(endIso, daysLeft)];
    return [];
  }

  const paidPlan =
    business.subscription_plan === 'essentials' || business.subscription_plan === 'professional'
      ? business.subscription_plan
      : null;
  if (business.subscription_status === 'active' && paidPlan !== null && business.subscription_ends_at) {
    const end = business.subscription_ends_at;
    const endIso = formatIstDateAsIso(end);
    if (end.getTime() <= now.getTime()) {
      return now.getTime() - end.getTime() < EXPIRED_WINDOW_MS ? [planExpiredDraft(false, endIso)] : [];
    }
    const daysLeft = diffDaysIso(todayIso, endIso);
    if (daysLeft === 7 || daysLeft === 1) return [planExpiringDraft(paidPlan, endIso, daysLeft)];
  }
  return [];
}
