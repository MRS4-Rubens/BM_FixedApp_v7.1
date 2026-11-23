'use client';

import { Users, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TeamSeats } from './types';
import { SettingsSectionBadge } from '../settings-section-badge';

export interface SeatSummaryProps {
  seats: TeamSeats;
  onSwitchTab?: (tab: string) => void;
  className?: string;
  embedded?: boolean;
}

export function SeatSummary({ seats, onSwitchTab, className, embedded = false }: SeatSummaryProps) {
  const isUnlimited = seats.limit === null;
  const userText = isUnlimited
    ? `${seats.used} users · Unlimited`
    : `${seats.used} of ${seats.limit} users`;

  const percent = isUnlimited
    ? 0
    : Math.min(100, Math.round((seats.used / (seats.limit || 1)) * 100));

  const planHint = `${seats.members} active member${seats.members === 1 ? '' : 's'} · ${seats.openInvites} open invite${seats.openInvites === 1 ? '' : 's'}`;

  return (
    <div className={cn(embedded ? 'space-y-3' : 'rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-4', className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          {embedded && <SettingsSectionBadge number={1} tone="emerald" />}
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <Users className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{embedded ? 'Team Members' : 'Team Seats'}</h3>
            <p className="text-xs text-muted-foreground">{planHint}</p>
          </div>
        </div>

        {/* UI stage 1: the seat rule sits with the seat count it explains. */}
        <div className="text-left sm:text-right">
          <span className="block text-sm font-extrabold text-foreground">{userText}</span>
          <span className="block text-[11px] text-muted-foreground">
            {isUnlimited ? 'Unlimited on your plan. ' : ''}Open invitations reserve seats.
          </span>
        </div>
      </div>

      {!isUnlimited && (
        <div
          role="progressbar"
          aria-label="Team seat usage"
          aria-valuenow={Math.min(seats.used, seats.limit ?? seats.used)}
          aria-valuetext={`${seats.used} of ${seats.limit} seats used`}
          aria-valuemin={0}
          aria-valuemax={seats.limit ?? undefined}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              seats.overLimit ? 'bg-amber-500' : 'bg-emerald-600'
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {seats.overLimit && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="leading-relaxed">
              Your plan allows {seats.limit} users but your team has {seats.members}. Nobody has been removed, but you can&apos;t invite anyone until you upgrade or remove a member.
            </p>
          </div>
          {onSwitchTab && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSwitchTab('Billing & Usage')}
              className="shrink-0 font-bold border-amber-300 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100 h-8 gap-1.5"
            >
              <span>Upgrade Plan</span>
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
