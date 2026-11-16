'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTeam } from '@/lib/actions/team/get-team';
import { SeatSummary } from './seat-summary';
import { InviteForm } from './invite-form';
import { InviteLinkPanel } from './invite-link-panel';
import { MembersList } from './members-list';
import { PendingInvites } from './pending-invites';
import { RoleGuide } from './role-guide';
import type { TeamData, InviteLinkResult } from './types';

export interface TeamTabProps {
  onSwitchTab?: (tab: string) => void;
  businessName?: string;
  initialData?: TeamData | null;
}

export function TeamTab({
  onSwitchTab,
  businessName = 'your business',
  initialData = null,
}: TeamTabProps) {
  const router = useRouter();
  const [data, setData] = useState<TeamData | null>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [activeInviteResult, setActiveInviteResult] = useState<InviteLinkResult | null>(null);
  const [activeInviteRole, setActiveInviteRole] = useState<'staff' | 'accountant'>('staff');

  const fetchTeam = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getTeam({});
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error.message);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load team data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!initialData) {
      getTeam({}).then((res) => {
        if (cancelled) return;
        if (res.success) {
          setData(res.data);
        } else {
          setError(res.error.message);
        }
        setIsLoading(false);
      }).catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load team data.');
        setIsLoading(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [initialData]);

  const handleMutationSuccess = useCallback(async () => {
    await fetchTeam();
    router.refresh();
  }, [fetchTeam, router]);

  const handleInviteSuccess = (result: InviteLinkResult, role?: 'staff' | 'accountant') => {
    setActiveInviteResult(result);
    setActiveInviteRole(role || 'staff');
    handleMutationSuccess();
  };

  const handleResendSuccess = (result: InviteLinkResult, role?: 'staff' | 'accountant') => {
    setActiveInviteResult(result);
    setActiveInviteRole(role || 'staff');
    handleMutationSuccess();
  };

  if (isLoading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-xl bg-muted/50 border border-border" />
        <div className="h-32 rounded-xl bg-muted/50 border border-border" />
        <div className="h-44 rounded-xl bg-muted/50 border border-border" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center space-y-3">
        <AlertCircle className="size-8 text-destructive mx-auto" />
        <div>
          <h3 className="text-sm font-bold text-foreground">Failed to load team</h3>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fetchTeam}
          className="gap-1.5 font-bold text-xs"
        >
          <RefreshCw className="size-3.5" />
          <span>Retry</span>
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-foreground shrink-0" aria-hidden="true" />
          <h2 className="text-xl font-bold font-heading text-foreground uppercase">Users &amp; Roles</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage team members, invitations, and role assignments for your business.
        </p>
      </div>

      {/* 1. Seat Summary Card */}
      <SeatSummary seats={data.seats} onSwitchTab={onSwitchTab} />

      {/* 2. Invite Form */}
      <InviteForm
        canInvite={data.canInvite}
        cannotInviteReason={data.cannotInviteReason}
        cannotInviteCode={data.cannotInviteCode}
        canInviteAccountant={data.canInviteAccountant}
        onInviteSuccess={handleInviteSuccess}
        onSwitchTab={onSwitchTab}
      />

      {/* 3. Invite Link Panel (shown after send / resend) */}
      {activeInviteResult && (
        <InviteLinkPanel
          result={activeInviteResult}
          businessName={businessName}
          role={activeInviteRole}
          onDone={() => setActiveInviteResult(null)}
        />
      )}

      {/* 4. Members List */}
      <MembersList
        members={data.members}
        canInviteAccountant={data.canInviteAccountant}
        onMemberRemoved={handleMutationSuccess}
        onRoleChanged={handleMutationSuccess}
      />

      {/* 5. Pending Invites */}
      <PendingInvites
        invites={data.invites}
        onResendSuccess={handleResendSuccess}
        onInviteRevoked={handleMutationSuccess}
      />

      {/* 6. Role Permissions Guide */}
      <RoleGuide />
    </div>
  );
}
