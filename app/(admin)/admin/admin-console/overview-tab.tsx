'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from 'recharts';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PayeeNotConfiguredNotice } from './payee-not-configured-notice';
import { ServerHealthCard } from './server-health-card';
import { buildRevenueChartData } from './chart-data';
import type { AdminStats, UpiConfig } from './types';

interface OverviewTabProps {
  stats: AdminStats;
  upiConfig: UpiConfig | null;
  payeeConfigIssue: string | null | undefined;
  isMounted: boolean;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onSelectTab: (tab: 'pending' | 'settings') => void;
}

export function OverviewTab({
  stats,
  upiConfig,
  payeeConfigIssue,
  isMounted,
  copiedKey,
  onCopy,
  onSelectTab,
}: OverviewTabProps) {
  const chartData = useMemo(() => {
    return buildRevenueChartData(stats.monthlyRevenue);
  }, [stats.monthlyRevenue]);

  const planDist = stats.planDistribution || {
    trial: 0,
    free: 0,
    essentials: 0,
    professional: 0,
  };
  const totalTrackedPlans = Object.values(planDist).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-4">
      <ServerHealthCard />
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Revenue Trend Chart (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-foreground font-heading">
                Subscription Revenue Trajectory
              </h3>
              <p className="text-xs font-semibold text-muted-foreground mt-0.5">
                Monthly subscription inflow over the last 6 calendar months (INR)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-600">
                <span className="size-2 rounded-full bg-indigo-600" />
                Gross Revenue
              </span>
            </div>
          </div>

          <div className="h-64 w-full pt-2">
            {isMounted && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `₹${val}`}
                  />
                  <RechartsTooltip
                    formatter={(val) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Revenue']}
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: 'bold',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#4f46e5"
                    strokeWidth={2.5}
                    fill="url(#revenueGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground font-semibold">
                No historical revenue data recorded yet.
              </div>
            )}
          </div>
        </div>

        {/* Right: Plan Distribution & Gateways Snapshot (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Plan Distribution meter */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <h3 className="text-base font-bold text-foreground font-heading">
              Tenant Plan Distribution
            </h3>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">
              Breakdown across subscription tiers
            </p>

            <div className="mt-4 space-y-3">
              {[
                { label: 'Trial', count: planDist.trial, color: 'bg-amber-500', barColor: 'bg-amber-500' },
                { label: 'Essentials', count: planDist.essentials, color: 'bg-indigo-500', barColor: 'bg-indigo-500' },
                { label: 'Professional', count: planDist.professional, color: 'bg-emerald-500', barColor: 'bg-emerald-500' },
                { label: 'Free Tier', count: planDist.free, color: 'bg-purple-500', barColor: 'bg-purple-500' },
              ].map((plan) => {
                const percentage = Math.round((plan.count / totalTrackedPlans) * 100);
                return (
                  <div key={plan.label} className="space-y-1">
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-foreground flex items-center gap-1.5">
                        <span className={cn('size-2.5 rounded-full', plan.color)} />
                        {plan.label}
                      </span>
                      <span className="text-muted-foreground font-mono font-medium">
                        {plan.count} ({percentage}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', plan.barColor)}
                        style={{ width: `${Math.max(percentage, percentage > 0 ? 5 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Gateway Snapshot Card */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground font-heading">
                Payee UPI & Bank Config
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectTab('settings')}
                className="h-6 text-xs font-bold text-indigo-600 hover:text-indigo-700 p-0"
              >
                Manage Config →
              </Button>
            </div>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">
              Current active manual payout endpoints
            </p>

            {upiConfig ? (
              <div className="mt-3.5 space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-2.5 border border-border/50">
                  <span className="text-muted-foreground font-medium">Payee UPI:</span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                    <span>{upiConfig.upiId}</span>
                    <button
                      type="button"
                      onClick={() => onCopy(upiConfig.upiId, 'upi-quick')}
                      className="text-muted-foreground hover:text-indigo-600 cursor-pointer"
                      title="Copy UPI ID"
                    >
                      {copiedKey === 'upi-quick' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-2.5 border border-border/50">
                  <span className="text-muted-foreground font-medium">Direct Bank IFSC:</span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                    <span>{upiConfig.ifsc}</span>
                    <button
                      type="button"
                      onClick={() => onCopy(upiConfig.ifsc, 'ifsc-quick')}
                      className="text-muted-foreground hover:text-indigo-600 cursor-pointer"
                      title="Copy IFSC"
                    >
                      {copiedKey === 'ifsc-quick' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3.5">
                <PayeeNotConfiguredNotice issue={payeeConfigIssue} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

