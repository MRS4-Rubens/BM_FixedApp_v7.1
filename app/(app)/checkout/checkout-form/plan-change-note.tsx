import { PLAN_CATALOG } from '@/lib/subscriptions/plan-catalog';
import { formatIstDate } from '@/lib/invoices/ist-date';
import type { PlanId, BillingCycle } from './plans';

export interface PlanPurchaseSummary {
  readonly kind: 'new' | 'renewal' | 'upgrade' | 'downgrade';
  readonly fromPlan: 'essentials' | 'professional' | null;
  readonly unusedDays: number;
  readonly creditedDays: number;
  readonly endsAt: string; // ISO string
}

export interface PlanChangeNoteProps {
  readonly purchase: PlanPurchaseSummary | null | undefined;
  readonly plan: PlanId;
  readonly cycle: BillingCycle;
}

export function PlanChangeNote({ purchase, plan, cycle }: PlanChangeNoteProps) {
  if (!purchase || purchase.kind === 'new') {
    return null;
  }

  const planName = PLAN_CATALOG[plan].name;
  const fromPlanName = purchase.fromPlan ? PLAN_CATALOG[purchase.fromPlan].name : '';
  const cycleWord = cycle === 'yearly' ? 'year' : 'month';
  const formattedExpiry = formatIstDate(purchase.endsAt, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  let mainSentence = '';
  if (purchase.kind === 'upgrade' || purchase.kind === 'downgrade') {
    mainSentence = `Switching from ${fromPlanName}: your ${purchase.unusedDays} unused days become ${purchase.creditedDays} days of ${planName}, then your paid ${cycleWord} starts. New expiry: ${formattedExpiry}.`;
  } else if (purchase.kind === 'renewal') {
    mainSentence = `Your current ${planName} plan continues; this ${cycleWord} is added after it ends. New expiry: ${formattedExpiry}.`;
  }

  return (
    <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3 text-xs space-y-1">
      <p className="text-amber-950 font-medium leading-relaxed">{mainSentence}</p>
      <p className="text-amber-800/80 text-[11px]">
        No refunds or part-payments: you always pay the plan&apos;s normal price.
      </p>
    </div>
  );
}
