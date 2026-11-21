'use client';

import { TrendingUp, ShieldCheck, Clock, Building2 } from 'lucide-react';
import { formatPaiseAsInr } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { AdminStats } from './types';

interface KpiCardsProps {
  stats: AdminStats;
  pendingCount: number;
  onSelectPendingTab: () => void;
}

export function KpiCards({ stats, pendingCount, onSelectPendingTab }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 xl:grid-cols-[1.13fr_1fr_0.87fr_1fr]">
      {/* Metric 1: Total Platform Revenue */}
      <div className="group relative overflow-hidden rounded-xl border border-border/80 bg-card min-w-0 px-3 sm:px-4 pt-3 pb-2.5 shadow-xs transition-all duration-200 hover:border-indigo-500/40 hover:shadow-sm">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 to-violet-600" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] leading-snug sm:text-xs font-bold uppercase tracking-wide sm:tracking-wider text-muted-foreground">
              Total Revenue
            </p>
            <h3 className="mt-1 text-xl min-[400px]:text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading tabular-nums [overflow-wrap:anywhere]">
              {formatPaiseAsInr(stats.totalRevenuePaise)}
            </h3>
          </div>
          <div className="flex size-7 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 transition-transform duration-200 group-hover:scale-105">
            <TrendingUp className="size-4.5" />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
          <span className="font-bold text-emerald-700">Reconciled</span>
          <span>from approved subscription claims</span>
        </div>
      </div>

      {/* Metric 2: Active Subscriptions */}
      <div className="group relative overflow-hidden rounded-xl border border-border/80 bg-card min-w-0 px-3 sm:px-4 pt-3 pb-2.5 shadow-xs transition-all duration-200 hover:border-emerald-500/40 hover:shadow-sm">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-500 to-teal-600" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] leading-snug sm:text-xs font-bold uppercase tracking-wide sm:tracking-wider text-muted-foreground">
              Active Subscriptions
            </p>
            <h3 className="mt-1 text-xl min-[400px]:text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading tabular-nums [overflow-wrap:anywhere]">
              {stats.activeSubscriptions}
            </h3>
          </div>
          <div className="flex size-7 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 transition-transform duration-200 group-hover:scale-105">
            <ShieldCheck className="size-4.5" />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
          <span className="font-semibold text-foreground">
            {Math.round((stats.activeSubscriptions / (stats.totalBusinesses || 1)) * 100)}%
          </span>
          <span>of registered businesses active</span>
        </div>
      </div>

      {/* Metric 3: Pending Claims */}
      <div
        onClick={onSelectPendingTab}
        className={cn(
          'group relative cursor-pointer overflow-hidden rounded-xl border min-w-0 px-3 sm:px-4 pt-3 pb-2.5 shadow-xs transition-all duration-200 hover:shadow-sm',
          pendingCount > 0
            ? 'border-amber-400 bg-amber-500/5 hover:border-amber-500'
            : 'border-border/80 bg-card hover:border-border'
        )}
      >
        {/* Permanent warm natural gradient ribbon */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 to-orange-500" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] leading-snug sm:text-xs font-bold uppercase tracking-wide sm:tracking-wider text-muted-foreground">
              Pending Verification
            </p>
            <h3 className="mt-1 text-xl min-[400px]:text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading tabular-nums [overflow-wrap:anywhere] flex items-center gap-2">
              {stats.pendingRequestsCount}
              {pendingCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-800">
                  Needs Action
                </span>
              )}
            </h3>
          </div>
          <div
            className={cn(
              'flex size-7 sm:size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105',
              pendingCount > 0
                ? 'bg-amber-500/15 text-amber-700'
                : 'bg-amber-500/10 text-amber-600'
            )}
          >
            <Clock className="size-4.5" />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
          <span>{pendingCount === 0 ? 'Queue is cleared' : 'Awaiting admin UTR confirmation'}</span>
        </div>
      </div>

      {/* Metric 4: Total Businesses & Platform Invoices */}
      <div className="group relative overflow-hidden rounded-xl border border-border/80 bg-card min-w-0 px-3 sm:px-4 pt-3 pb-2.5 shadow-xs transition-all duration-200 hover:border-blue-500/40 hover:shadow-sm">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-indigo-600" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] leading-snug sm:text-xs font-bold uppercase tracking-wide sm:tracking-wider text-muted-foreground">
              Total Businesses
            </p>
            <h3 className="mt-1 text-xl min-[400px]:text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading tabular-nums [overflow-wrap:anywhere]">
              {stats.totalBusinesses}
            </h3>
          </div>
          <div className="flex size-7 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105">
            <Building2 className="size-4.5" />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
          <span className="font-semibold text-foreground">{stats.platformInvoiceCount || 0}</span>
          <span>invoices created across tenants</span>
        </div>
      </div>
    </div>
  );
}

