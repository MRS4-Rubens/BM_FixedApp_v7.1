'use client';

import { useState, useTransition, useId } from 'react';
import { Mail, UserPlus, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inviteTeamMember } from '@/lib/actions/team/invite-team-member';
import type { InviteLinkResult } from './types';

export interface InviteFormProps {
  canInvite: boolean;
  cannotInviteReason: string | null;
  /** From getTeam: 'TEAM_PLAN_REQUIRED' (upgrading helps) or 'TEAM_SEAT_LIMIT' (free a seat instead). */
  cannotInviteCode?: string | null;
  onInviteSuccess: (result: InviteLinkResult) => void;
  onSwitchTab?: (tab: string) => void;
}

export function InviteForm({
  canInvite,
  cannotInviteReason,
  cannotInviteCode = null,
  onInviteSuccess,
  onSwitchTab,
}: InviteFormProps) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Only the Free plan can be upgraded to get team seats today (Professional is not purchasable yet).
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
      const result = await inviteTeamMember({ email: cleanEmail });
      if (result.success) {
        setEmail('');
        setError(null);
        onInviteSuccess(result.data);
      } else {
        const fieldError = result.error.fieldErrors?.email?.[0];
        setError(fieldError || result.error.message);
      }
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="size-4 text-primary shrink-0" />
        <h3 className="text-sm font-bold text-foreground">Invite a Team Member</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Invited team members can create and send invoices, record payments, and manage catalog data.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
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
              className="h-9 font-bold text-xs sm:text-sm gap-1.5 shrink-0"
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
