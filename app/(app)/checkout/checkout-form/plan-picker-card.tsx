'use client';

import { CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPaiseAsInr } from '@/lib/money';
import { PLANS, ESSENTIALS_YEARLY_SAVING, type PlanId, type BillingCycle } from './plans';

export function PlanPickerCard({
  billingCycle,
  handleCycleChange,
  selectedPlan,
  handlePlanChange,
  currentSubscriptionPlan,
  annualSavingsPaise,
}: {
  billingCycle: BillingCycle;
  handleCycleChange: (cycle: BillingCycle) => void;
  selectedPlan: PlanId;
  handlePlanChange: (planId: PlanId) => void;
  currentSubscriptionPlan: string;
  annualSavingsPaise: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-bold">
              1
            </span>
            <h2 className="text-lg font-extrabold text-slate-900 font-heading tracking-tight">
              Select Your Subscription Tier
            </h2>
          </div>
          <p className="text-sm text-slate-500 mt-1 ml-8">
            Choose the plan that matches your business throughput.
          </p>
        </div>

        {/* Cycle Toggle with Annual Savings Pill */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl w-fit self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleCycleChange('monthly')}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer',
              billingCycle === 'monthly'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => handleCycleChange('yearly')}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5',
              billingCycle === 'yearly'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <span>Yearly</span>
            <span className="bg-emerald-100 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded text-xs font-extrabold">
              SAVE {ESSENTIALS_YEARLY_SAVING}%
            </span>
          </button>
        </div>
      </div>

      {/* Annual Savings Alert */}
      {billingCycle === 'yearly' && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-sm font-semibold text-emerald-900 shadow-2xs">
          <Sparkles className="size-4 text-emerald-600 shrink-0" />
          <span>
            You are saving <strong>{formatPaiseAsInr(annualSavingsPaise)}</strong> per year with annual billing (includes 2 months free)!
          </span>
        </div>
      )}

      {/* Pricing Grid */}
      <div className="mt-3.5 grid gap-4 sm:grid-cols-2">
        {PLANS.map((plan) => {
          const price = billingCycle === 'monthly' ? plan.monthlyPricePaise : plan.yearlyPricePaise;
          const isSelected = selectedPlan === plan.id;
          const isCurrent = currentSubscriptionPlan.toLowerCase() === plan.id;

          return (
            <button
              key={plan.id}
              type="button"
              disabled={!plan.purchasable}
              onClick={() => plan.purchasable && handlePlanChange(plan.id)}
              className={cn(
                'flex flex-col justify-between text-left p-3.5 sm:p-4 rounded-2xl border-2 transition-all relative overflow-hidden',
                !plan.purchasable
                  ? 'cursor-not-allowed border-dashed border-slate-300 bg-slate-50'
                  : isSelected
                  ? 'border-indigo-600 ring-2 ring-indigo-500/10 shadow-md bg-gradient-to-b from-white to-indigo-50/30 cursor-pointer'
                  : 'border-slate-200/80 hover:border-slate-300 bg-slate-50/40 hover:bg-white cursor-pointer'
              )}
            >
              {/* Top Badges */}
              <div className="w-full">
                <div className="flex justify-between items-center w-full mb-1">
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-500">
                    {plan.name}
                  </span>
                  {!plan.purchasable ? (
                    <span className="rounded-full bg-slate-200 border border-slate-300 text-slate-700 px-2.5 py-0.5 text-xs font-semibold shadow-2xs">
                      Coming soon
                    </span>
                  ) : isCurrent ? (
                    <span className="rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 px-2.5 py-0.5 text-xs font-extrabold shadow-2xs">
                      Current Tier
                    </span>
                  ) : plan.popular ? (
                    <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-0.5 text-xs font-extrabold shadow-2xs">
                      Most Popular
                    </span>
                  ) : null}
                </div>

                <p className="text-xs text-slate-500 leading-snug mb-1.5">
                  {plan.tagline}
                </p>

                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black font-heading text-slate-900">
                    {formatPaiseAsInr(price)}
                  </span>
                  <span className="text-sm text-slate-500 font-semibold">
                    {billingCycle === 'monthly' ? '/ month' : '/ year'}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 border-t border-dashed border-slate-200 pt-2 w-full space-y-1.5">
                <ul className="space-y-1">
                  {plan.features.slice(0, 4).map((feat, i) => (
                    <li key={i} className="text-xs text-slate-800 flex items-center gap-1.5 font-medium">
                      {feat.status === 'coming_soon' ? (
                        <Clock className="size-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                      )}
                      <span className={feat.status === 'coming_soon' ? 'text-slate-600' : ''}>
                        {feat.label}
                        {feat.status === 'coming_soon' && <span className="sr-only"> (coming soon)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

