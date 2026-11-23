import { formatIstDate } from '@/lib/invoices/ist-date';
import type { SubscriptionHistoryItem } from './types';

/**
 * UI stage 1: the one-line notice under the validity bar on Billing and Usage. The most urgent situation wins:
 * suspended > payment under review > last claim rejected > Free plan > expired > trial > renewal due > active.
 */
export type PlanNoticeTone = 'emerald' | 'amber' | 'rose' | 'blue' | 'slate';

export interface PlanNotice {
  tone: PlanNoticeTone;
  title: string;
  body: string;
}

export const PLAN_NOTICE_TONE: Record<PlanNoticeTone, string> = {
  emerald: 'text-emerald-800',
  amber: 'text-amber-800',
  rose: 'text-rose-700',
  blue: 'text-blue-800',
  slate: 'text-slate-600',
};

interface PlanNoticeInput {
  planKey: string;
  status: string;
  isActive: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number | null;
  targetExpiry: Date | string | null | undefined;
  activatedAt: Date | string | null | undefined;
  /** Newest payment claim of this business, if any. */
  latestClaim: SubscriptionHistoryItem | null;
}

/** Whole rupees when there are no paise (no ".00"), as in the plan prices. */
function rupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

function day(value: Date | string): string {
  return formatIstDate(value, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getPlanNotice(input: PlanNoticeInput): PlanNotice {
  const { planKey, status, isActive, isExpired, isExpiringSoon, daysRemaining, targetExpiry, activatedAt, latestClaim } =
    input;

  if (status === 'suspended') {
    return {
      tone: 'rose',
      title: 'Your account is suspended.',
      body: "You can view and download your data, but you can't create or change documents. Contact support to resolve it.",
    };
  }

  if (latestClaim?.status === 'pending') {
    return {
      tone: 'blue',
      title: `We're checking your payment of ${rupees(latestClaim.amountPaise)}.`,
      body: "Usually within 1 working day. You'll get an e-mail and a bell notice when it's approved.",
    };
  }

  // A rejection counts only if nothing was activated after it (an approved payment since then supersedes it).
  const rejectedIsLatest =
    latestClaim?.status === 'rejected' &&
    (!activatedAt || new Date(latestClaim.createdAt).getTime() > new Date(activatedAt).getTime());
  if (rejectedIsLatest) {
    return {
      tone: 'rose',
      title: 'Your last payment claim was not approved.',
      body: `${latestClaim?.rejectReason ? `Reason: "${latestClaim.rejectReason}" ` : ''}Check the UTR and submit again, or contact support.`,
    };
  }

  if (planKey === 'free') {
    return {
      tone: 'slate',
      title: 'The Free plan has no end date.',
      body: 'Upgrade any time for unlimited invoices, all templates and WhatsApp sharing.',
    };
  }

  if (isExpired) {
    if (planKey === 'trial') {
      return {
        tone: 'rose',
        title: 'Your trial has ended.',
        body: 'Choose a plan to get unlimited invoices, all templates and WhatsApp sharing back.',
      };
    }
    return {
      tone: 'rose',
      title: targetExpiry ? `Your plan expired on ${day(targetExpiry)}.` : 'Your plan has expired.',
      body: 'Paid features are paused. Your invoices and data are safe; renew to continue where you left off.',
    };
  }

  if (planKey === 'trial' || status === 'trial') {
    if (daysRemaining !== null && daysRemaining <= 2) {
      return {
        tone: 'amber',
        title: targetExpiry ? `Your trial ends on ${day(targetExpiry)}.` : 'Your trial ends soon.',
        body: 'After that you move to the Free plan (30 invoices a month). Your data stays safe.',
      };
    }
    return {
      tone: 'amber',
      title: 'Your trial includes everything in Essentials Pro.',
      body: 'Choose a plan before it ends to keep those features.',
    };
  }

  if (isActive && isExpiringSoon) {
    return {
      tone: 'amber',
      title: targetExpiry ? `Your plan renews by ${day(targetExpiry)}.` : 'Your plan renews soon.',
      body: 'Renew now so invoicing, WhatsApp sharing and exports keep working. Early renewal adds to your remaining days.',
    };
  }

  if (isActive) {
    return {
      tone: 'emerald',
      title: 'All paid features are active.',
      body: 'Renew any time; early renewal adds to your remaining days.',
    };
  }

  return {
    tone: 'slate',
    title: 'Your plan is not active.',
    body: 'Choose a plan to unlock paid features.',
  };
}
