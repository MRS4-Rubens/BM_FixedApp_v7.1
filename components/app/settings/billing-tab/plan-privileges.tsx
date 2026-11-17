'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Sparkles, CheckCircle2, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPlanPrice } from '@/lib/subscriptions/plan-catalog';
import { useIsOwner } from '@/components/app/current-user-role';
import { PLAN_CONFIGS, type PlanDefinition } from './plan-configs';

interface PlanPrivilegesProps {
  planConfig: PlanDefinition;
  currentPlanKey: string;
}

export function PlanPrivileges({ planConfig, currentPlanKey }: PlanPrivilegesProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'compare'>('current');
  const isOwner = useIsOwner();

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-600" />
            Availed Services & Tier Privileges
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Service levels, automation privileges, and compliance features unlocked for your business account.
          </p>
        </div>

        <div className="flex rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('current')}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-semibold transition-all cursor-pointer',
              activeTab === 'current'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-900'
            )}
          >
            Current Tier
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('compare')}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-semibold transition-all cursor-pointer flex items-center gap-1',
              activeTab === 'compare'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-900'
            )}
          >
            Compare All Tiers
            <Sparkles className="size-3.5 text-amber-500" />
          </button>
        </div>
      </div>

      {activeTab === 'current' ? (
        <div className="flex flex-wrap gap-2.5">
          {planConfig.features.map((feature, idx) => (
            <div
              key={idx}
              className={cn(
                'w-fit inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold shadow-2xs whitespace-nowrap transition-colors',
                feature.status === 'included'
                  ? 'border-slate-200/80 bg-slate-50/70 text-slate-800 hover:border-indigo-300 hover:bg-white'
                  : 'border-dashed border-slate-300 bg-slate-50 text-slate-600'
              )}
            >
              {feature.status === 'included' ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              ) : (
                <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full">
                  Coming soon
                </span>
              )}
              <span>{feature.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Essentials Tier */}
          <div
            className={cn(
              'rounded-xl border p-4.5 transition-all',
              currentPlanKey === 'essentials' ? 'border-indigo-200 bg-indigo-50/20' : 'border-slate-200/80 bg-slate-50/40'
            )}
          >
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-base font-extrabold text-slate-900">{PLAN_CONFIGS.essentials.name}</h4>
              {currentPlanKey === 'essentials' ? (
                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full shadow-2xs">
                  Your Current Plan
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{formatPlanPrice('essentials', 'monthly').headline}/mo</span>
                  {isOwner && (
                    <Link
                      href="/checkout?plan=essentials"
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                    >
                      {currentPlanKey === 'professional' ? 'Switch' : 'Upgrade'}
                    </Link>
                  )}
                </div>
              )}
            </div>
            <ul className="space-y-2 mt-3 text-sm">
              {PLAN_CONFIGS.essentials.features.map((feat, i) =>
                feat.status === 'included' ? (
                  <li key={i} className="flex items-center gap-2 text-slate-600">
                    <Check className="size-4 text-emerald-600 shrink-0" />
                    <span>{feat.label}</span>
                  </li>
                ) : (
                  <li key={i} className="flex items-center gap-2 text-slate-600">
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded-full">
                      Coming soon
                    </span>
                    <span>{feat.label}</span>
                  </li>
                )
              )}
            </ul>
          </div>

          {/* Professional Tier */}
          <div
            className={cn(
              'rounded-xl border p-4.5 transition-all',
              currentPlanKey === 'professional' ? 'border-indigo-200 bg-indigo-50/20' : 'border-slate-200/80 bg-slate-50/40'
            )}
          >
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-base font-extrabold text-slate-900">{PLAN_CONFIGS.professional.name}</h4>
              {currentPlanKey === 'professional' ? (
                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full shadow-2xs">
                  Your Current Plan
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{formatPlanPrice('professional', 'monthly').headline}/mo</span>
                  {isOwner && (
                    <Link
                      href="/checkout?plan=professional"
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                    >
                      Upgrade
                    </Link>
                  )}
                </div>
              )}
            </div>
            <ul className="space-y-2 mt-3 text-sm">
              {PLAN_CONFIGS.professional.features.map((feat, i) =>
                feat.status === 'included' ? (
                  <li key={i} className="flex items-center gap-2 text-slate-600 font-medium">
                    <Check className="size-4 text-indigo-600 shrink-0" />
                    <span>{feat.label}</span>
                  </li>
                ) : (
                  <li key={i} className="flex items-center gap-2 text-slate-600">
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded-full">
                      Coming soon
                    </span>
                    <span>{feat.label}</span>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Upgrade Incentive Bar (if on free/trial) */}
      {currentPlanKey !== 'essentials' && currentPlanKey !== 'professional' && (
        <div className="mt-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-purple-50/40 py-2.5 px-3.5">
          <div className="flex items-center gap-2.5">
            <Sparkles className="size-4 text-amber-500 shrink-0" />
            <p className="text-sm text-slate-600">
              Unlock <strong className="text-slate-900">unlimited invoices</strong>,{' '}
              <strong className="text-slate-900">all 4 templates</strong>, and{' '}
              <strong className="text-slate-900">WhatsApp sharing</strong> with Essentials Pro.
            </p>
          </div>
          <Link href="/checkout?plan=essentials">
            <Button size="sm" className="h-8 text-xs font-bold gap-1 bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shrink-0 shadow-xs">
              Upgrade to Essentials Pro <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

