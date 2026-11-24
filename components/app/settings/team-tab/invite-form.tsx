'use client';

import { useState, useTransition, useId } from 'react';
import Link from 'next/link';
import { Mail, UserPlus, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inviteTeamMember } from '@/lib/actions/team/invite-team-member';
import { cn } from '@/lib/utils';
import { useIsOwner } from '@/components/app/current-user-role';
import type { InviteLinkResult } from './types';
import { SettingsSectionBadge } from '../settings-section-badge';

export interface InviteFormProps {
  canInvite: boolean;
  cannotInviteReason: string | null;
  /** From getTeam: 'TEAM_PLAN_REQUIRED' (upgrading helps) or 'TEAM_SEAT_LIMIT' (free a seat instead). */
  cannotInviteCode?: string | null;
  canInviteAccountant?: boolean;
  onInviteSuccess: (result: InviteLinkResult, role?: 'staff' | 'accountant') => void;
  onSwitchTab?: (tab: string) => void;
}

export function InviteForm({
  canInvite,
  cannotInviteReason,
  cannotInviteCode = null,
  canInviteAccountant = false,
  onInviteSuccess,
  onSwitchTab,
}: InviteFormProps) {
  const id = useId();
  const isOwner = useIsOwner();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'accountant'>('staff');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Free plan can be upgraded to Essentials or Professional to get team seats.
  const isUpgradeReason = cannotInviteCode === 'TEAM_PLAN_REQUIRED';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter an e-mail address.');
      return;
    }

    startTransition(async () => {
      const result = await inviteTeamMember({ email: cleanEmail, role });
      if (result.success) {
        setEmail('');
        setError(null);
        onInviteSuccess(result.data, role);
      } else {
        const fieldError = result.error.fieldErrors?.email?.[0];
        setError(fieldError || result.error.message);
      }
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex items-center gap-2 mb-1">
        <SettingsSectionBadge number={2} tone="amber" />
        <UserPlus className="size-4 text-primary shrink-0" />
        <h3 className="text-sm font-bold text-foreground">Invite a Team Member</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Invited team members can create and send invoices, record payments, and manage catalog data.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <fieldset className="space-y-1.5 pt-1">
          <legend className="block text-xs font-semibold text-foreground mb-1.5">
            Role
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-all",
                role === 'staff'
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border bg-background hover:bg-muted/40",
                (!canInvite || isPending) && "opacity-50 cursor-not-allowed"
              )}
            >
              <input
                type="radio"
                name="invite-role"
                value="staff"
                checked={role === 'staff'}
                onChange={() => setRole('staff')}
                disabled={!canInvite || isPending}
                className="mt-0.5 size-4 text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5">
                <span className="block text-xs sm:text-sm font-bold text-foreground">
                  Team member
                </span>
                <span className="block text-[11px] text-muted-foreground leading-normal">
                  Can create invoices, record payments, manage customers and products.
                </span>
              </div>
            </label>

            <label
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 transition-all",
                !canInviteAccountant || !canInvite || isPending
                  ? "opacity-60 cursor-not-allowed bg-muted/20 border-border"
                  : role === 'accountant'
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20 cursor-pointer"
                  : "border-border bg-background hover:bg-muted/40 cursor-pointer"
              )}
            >
              <input
                type="radio"
                name="invite-role"
                value="accountant"
                checked={role === 'accountant'}
                onChange={() => setRole('accountant')}
                disabled={!canInviteAccountant || !canInvite || isPending}
                className="mt-0.5 size-4 text-primary focus:ring-primary/20"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs sm:text-sm font-bold text-foreground">
                    Accountant (read-only)
                  </span>
                  {!canInviteAccountant && (
                    isOwner ? (
                      <Link
                        href="/checkout?plan=professional"
                        className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 transition cursor-pointer"
                      >
                        Professional plan
                      </Link>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Professional plan
                      </span>
                    )
                  )}
                </div>
                <span className="block text-[11px] text-muted-foreground leading-normal">
                  Can view everything and download reports. Cannot change anything.
                </span>
              </div>
            </label>
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-email`} className="block text-xs font-semibold text-foreground mb-1.5">
            E-mail address
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                id={`${id}-email`}
                type="email"
                autoComplete="off"
                disabled={!canInvite || isPending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@yourbusiness.com"
                className="w-full h-9 rounded-lg border border-border bg-background pl-9 pr-3 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              />
            </div>
            <Button
              type="submit"
              disabled={!canInvite || isPending}
              className="btn-shine-navy h-9 font-bold text-xs sm:text-sm gap-1.5 shrink-0"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Sending…</span>
                </>
              ) : (
                <>
                  <UserPlus className="size-3.5" />
                  <span>Send invite</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-destructive mt-1">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!canInvite && cannotInviteReason && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <p>{cannotInviteReason}</p>
            {isUpgradeReason && onSwitchTab && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSwitchTab('Billing & Usage')}
                className="self-start sm:self-auto h-7 text-xs font-bold gap-1 border-primary/30 text-primary hover:bg-primary/5"
              >
                <Sparkles className="size-3" />
                <span>Upgrade plan</span>
              </Button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
