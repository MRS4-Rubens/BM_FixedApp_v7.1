'use client';

import Link from 'next/link';
import {
  Crown,
  Sparkles,
  Clock,
  AlertCircle,
  RefreshCw,
  CreditCard,
  CheckCircle2,
  Check,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { TRIAL_DURATION_DAYS } from '@/lib/subscriptions/entitlements';
import type { businesses } from '@/lib/db/schema';
import type { PlanDefinition } from './plan-configs';
import { SettingsSectionBadge } from '../settings-section-badge';
import { PLAN_NOTICE_TONE, type PlanNotice } from './plan-notice';

interface PlanOverviewCardProps {
  business: typeof businesses.$inferSelect | null;
  planConfig: PlanDefinition;
  status: string;
  isActive: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number | null;
  targetExpiry: Date | string | null | undefined;
  lifecycleProgress: number | null;
  copiedUtr: string | null;
  onCopy: (text: string) => void;
  /** UI stage 1: the coloured line under the validity bar (see plan-notice.ts). */
  notice: PlanNotice;
}

export function PlanOverviewCard({
  business,
  planConfig,
  status,
  isActive,
  isExpired,
  isExpiringSoon,
  daysRemaining,
  targetExpiry,
  lifecycleProgress,
  copiedUtr,
  onCopy,
  notice,
}: PlanOverviewCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      {/* UI stage 1: numbered section header (read by the Settings side panel's "On this page"). */}
      <div className="flex items-center gap-2 pb-2.5 mb-3.5 border-b border-[oklch(0.82_0.015_255)]">
        <SettingsSectionBadge number={1} tone="emerald" />
        <h3 className="text-base font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Crown className="size-4 text-emerald-800" />
          Current Plan
        </h3>
      </div>

      <div className="flex flex-row items-start justify-between gap-4.5">
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1 text-sm font-bold text-slate-700 shadow-2xs">
              <Crown className="size-4" />
              Current Tier
            </span>

            {/* Universal Status Badge */}
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 shadow-2xs">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Active Subscription
              </span>
            ) : status === 'trial' && !isExpired ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800 shadow-2xs">
                <Clock className="size-4" />
                Trial Period ({daysRemaining ?? TRIAL_DURATION_DAYS} days left)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-rose-50 px-3 py-1 text-sm font-bold text-rose-700 shadow-2xs">
                <AlertCircle className="size-4" />
                {status === 'suspended' ? 'Suspended Account' : 'Plan Expired'}
              </span>
            )}

            {planConfig.badge && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600 shadow-2xs">
                <Sparkles className="size-3.5 text-amber-500" />
                {planConfig.badge}
              </span>
            )}
          </div>

          {/* UI stage 1: the price sits beside the plan name. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-heading">
              {planConfig.name}
            </h2>
            <span className="text-sm sm:text-base font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-md">{planConfig.price}</span>
          </div>
        </div>

        {/* Action CTAs */}
        <div className="flex flex-col gap-2.5 shrink-0 w-auto">
          <Link href="/checkout?action=upgrade">
            <Button className="btn-shine-navy w-full h-10 gap-2 text-sm font-bold cursor-pointer rounded-xl whitespace-nowrap shrink-0">
              <Sparkles className="size-4 shrink-0" />
              <span className="whitespace-nowrap">Upgrade / Change Plan</span>
            </Button>
          </Link>

          <Link href="/checkout?action=renew">
            <Button
              variant="outline"
              className="w-full h-10 gap-2 border-emerald-300 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 text-sm font-bold cursor-pointer rounded-xl transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 shadow-2xs whitespace-nowrap shrink-0"
            >
              <RefreshCw className="size-4 shrink-0" />
              <span className="whitespace-nowrap">Renew Early</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* -- Subscription Validity & Payment Settlement Lockup (Option B Hybrid) -- */}
      <div className="mt-3.5 grid grid-cols-[3fr_2fr] gap-3 border-t border-[oklch(0.82_0.015_255)] pt-3.5">
        {/* Card 1: Subscription Validity */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 font-bold uppercase tracking-wider">
                <Clock className="size-4 text-slate-700 shrink-0" />
                <span>Subscription Validity :</span>
                {daysRemaining !== null ? (
                  isExpired ? (
                    <span className="font-extrabold text-rose-600 normal-case">Expired</span>
                  ) : (
                    <span
                      className={cn(
                        'font-black font-heading normal-case text-sm',
                        isExpiringSoon ? 'text-amber-800' : 'text-emerald-700'
                      )}
                    >
                      {daysRemaining} {daysRemaining === 1 ? 'Day Remaining' : 'Days Remaining'}
                    </span>
                  )
                ) : (
                  <span className="font-bold text-slate-800 normal-case">Continuous Active</span>
                )}
              </div>

              {targetExpiry && (
                <span className="text-xs font-medium text-slate-500">
                  ({isActive ? 'Renews' : 'Valid until'}{' '}
                  <strong className="text-slate-700">
                    {formatIstDate(targetExpiry, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </strong>)
                </span>
              )}
            </div>

            {/* Lifecycle Progress Bar (Reference Image 2 Style) */}
            {lifecycleProgress !== null && (
              <div className="mt-3 pt-2.5 border-t border-[oklch(0.82_0.015_255)]">
                <div className="flex justify-between items-center text-xs text-slate-500 mb-1.5 font-medium">
                  <span>
                    Days Elapsed: <strong className="text-slate-800 font-semibold">{lifecycleProgress}%</strong>
                  </span>
                  <span>
                    {business?.subscription_activated_at ? (
                      <>
                        Activated{' '}
                        <strong className="text-slate-700">
                          {formatIstDate(business.subscription_activated_at, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </strong>
                      </>
                    ) : (
                      `${daysRemaining ?? 0} days remaining`
                    )}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-700 ease-out',
                      isExpired
                        ? 'bg-rose-500 w-full'
                        : isExpiringSoon
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                    )}
                    style={{ width: `${Math.min(100, Math.max(4, lifecycleProgress))}%` }}
                  />
                </div>
              </div>
            )}

            {/* UI stage 1: plain coloured notice under the validity bar. */}
            <p role="status" className={cn('mt-2.5 text-xs leading-relaxed', PLAN_NOTICE_TONE[notice.tone])}>
              <strong className="font-bold">{notice.title}</strong> {notice.body}
            </p>
          </div>
        </div>

        {/* Card 2: Payment Settlement */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-600">
              <span className="flex items-center gap-1.5">
                <CreditCard className="size-4 text-slate-700 shrink-0" />
                Payment Settlement
              </span>
              {business?.active_utr_no ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full shadow-2xs">
                  <CheckCircle2 className="size-3 text-emerald-600" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full shadow-2xs">
                  Free Tier
                </span>
              )}
            </div>

            <div className="mt-3 pt-2.5 border-t border-[oklch(0.82_0.015_255)] flex items-center gap-2.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                {business?.active_utr_no ? 'Active UTR:' : 'Plan Mode:'}
              </span>

              {business?.active_utr_no ? (
                <div className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 pl-2.5 pr-1.5 py-0.5 rounded-lg shadow-2xs">
                  <span>{business.active_utr_no}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(business.active_utr_no!)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
                    title="Copy UTR Reference"
                  >
                    {copiedUtr === business.active_utr_no ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-bold font-sans">
                        <Check className="size-3 text-emerald-700" /> Copied
                      </span>
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
              ) : (
                <span className="font-mono text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs">
                  Free / Trial Tier
                </span>
              )}

              <span className="text-[11px] text-slate-400 font-normal">
                {business?.active_utr_no
                  ? 'Bank cleared & verified transaction reference'
                  : 'No manual bank transfer required for this tier'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

