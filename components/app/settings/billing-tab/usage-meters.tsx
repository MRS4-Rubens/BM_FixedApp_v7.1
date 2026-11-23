'use client';

import { TrendingUp, FileText, CheckCircle2, Package, Check, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatShortMonth, type PlanDefinition } from './plan-configs';
import type { UsageStats } from './types';
import { SettingsSectionBadge } from '../settings-section-badge';

interface UsageMetersProps {
  usageStats: UsageStats;
  planConfig: PlanDefinition;
  currentPlanKey: string;
  whatsapp: boolean;
  excel: boolean;
}

export function UsageMeters({
  usageStats,
  planConfig,
  currentPlanKey,
  whatsapp,
  excel,
}: UsageMetersProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      <div className="flex flex-row items-start justify-between gap-2 mb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <SettingsSectionBadge number={2} tone="amber" />
            <h3 className="text-base font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="size-4 text-indigo-500" />
            Live Resource Consumption & Quotas
          </h3>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Your usage this month and your catalogue size.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Meter 1: Invoices Generated */}
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 sm:p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs sm:text-[13px] font-semibold text-slate-500 mb-1.5 gap-1.5">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <FileText className="size-4 text-indigo-500 shrink-0" />
                Monthly Invoices
              </span>
              {/* Refined Image 3 Month Badge (3-4 Letter Short Month Format) */}
              <span className="text-[11px] uppercase font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.5 rounded-md shadow-2xs shrink-0 whitespace-nowrap">
                {formatShortMonth(usageStats.currentMonthLabel)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-black font-heading text-slate-900">
                {usageStats.invoicesThisMonth}
              </span>
              <span className="text-sm text-slate-500 font-medium">
                {planConfig.invoiceMonthlyLimit ? `/ ${planConfig.invoiceMonthlyLimit}` : 'invoices created'}
              </span>
            </div>

            {/* Progress bar or unlimited badge */}
            {planConfig.invoiceMonthlyLimit ? (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Quota: {Math.round((usageStats.invoicesThisMonth / planConfig.invoiceMonthlyLimit) * 100)}%</span>
                  <span>{Math.max(0, planConfig.invoiceMonthlyLimit - usageStats.invoicesThisMonth)} remaining</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (usageStats.invoicesThisMonth / planConfig.invoiceMonthlyLimit) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 text-xs font-bold text-emerald-700 shadow-2xs">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                <span>Unlimited Invoicing Quota</span>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2 pt-1.5 border-t border-slate-200/60">
            Total lifetime invoices: <strong className="text-slate-800">{usageStats.invoicesTotal}</strong>
          </p>
        </div>

        {/* Meter 2: Client & Catalog Volume */}
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 sm:p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-sm font-semibold text-slate-500 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Package className="size-4 text-indigo-500" />
                Catalog & CRM
              </span>
              {/* Refined Image 3 Active Badge */}
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-md shadow-2xs">
                Active
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1 sm:gap-1.5 whitespace-nowrap">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-heading text-slate-900">
                  {usageStats.customersCount}
                </span>
                <span className="text-xs sm:text-[13px] text-slate-500 font-medium">
                  {currentPlanKey === 'free' ? '/ 30' : ''} Clients
                </span>
              </div>

              <span className="text-slate-300 font-light px-0.5">•</span>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-heading text-slate-900">
                  {usageStats.productsCount}
                </span>
                <span className="text-xs sm:text-[13px] text-slate-500 font-medium">
                  {currentPlanKey === 'free' ? '/ 30' : ''} Items
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11.5px] sm:text-xs text-slate-600 whitespace-nowrap">
              <Check className="size-3.5 shrink-0 text-emerald-600" />
              <span className="truncate">
                {currentPlanKey === 'free' ? 'Up to 30 Customers & Products' : 'Unlimited Customers & Products'}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-2 pt-1.5 border-t border-slate-200/60">
            Search products by name or HSN/SAC
          </p>
        </div>

        {/* Meter 3: Compliance & Export Automation */}
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 sm:p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-sm font-semibold text-slate-500 mb-1.5">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-emerald-600" />
                Automation Status
              </span>
              {/* Refined Image 3 Ready Badge */}
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-md shadow-2xs">
                Ready
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-[13px] gap-1">
                <span className="text-slate-500 font-medium whitespace-nowrap">WhatsApp / Email:</span>
                <span className={cn('font-bold whitespace-nowrap', whatsapp ? 'text-emerald-700' : 'text-slate-700')}>
                  {whatsapp ? 'Enabled' : 'E-mail only'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-[13px] gap-1">
                <span className="text-slate-500 font-medium whitespace-nowrap">GSTR-1 & ITR Export:</span>
                <span className={cn('font-bold whitespace-nowrap', excel ? 'text-emerald-700' : 'text-slate-700')}>
                  {excel ? '1-Click Excel' : 'Essentials Pro'}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <Zap className="size-4 text-amber-500" />
              <span>Automated GST Calculation</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-2 pt-1.5 border-t border-slate-200/60">
            Audit log immutability active
          </p>
        </div>
      </div>
    </div>
  );
}
