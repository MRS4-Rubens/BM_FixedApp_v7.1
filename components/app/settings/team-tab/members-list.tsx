'use client';

import { useState, useTransition } from 'react';
import { UserCheck, UserCog, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { INVITABLE_ROLES, isOneOf } from '@/lib/db/domain-values';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { removeTeamMember } from '@/lib/actions/team/remove-team-member';
import { changeTeamMemberRole } from '@/lib/actions/team/change-team-member-role';
import { roleLabel } from '@/components/app/current-user-role';
import { cn } from '@/lib/utils';
import type { TeamMember } from './types';

export interface MembersListProps {
  members: TeamMember[];
  canInviteAccountant?: boolean;
  onMemberRemoved: () => void;
  onRoleChanged?: () => void;
  embedded?: boolean;
}

export function MembersList({
  members,
  canInviteAccountant = false,
  onMemberRemoved,
  onRoleChanged,
  embedded = false,
}: MembersListProps) {
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: TeamMember;
    newRole: 'staff' | 'accountant';
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return;
    setError(null);
    startTransition(async () => {
      const result = await removeTeamMember({ user_id: memberToRemove.id });
      if (result.success) {
        setMemberToRemove(null);
        onMemberRemoved();
      } else {
        setError(result.error.message);
      }
    });
  };

  const handleConfirmRoleChange = async () => {
    if (!pendingRoleChange) return;
    setError(null);
    startTransition(async () => {
      const result = await changeTeamMemberRole({
        user_id: pendingRoleChange.member.id,
        role: pendingRoleChange.newRole,
      });
      if (result.success) {
        setPendingRoleChange(null);
        onRoleChanged?.();
      } else {
        setError(result.error.message);
        setPendingRoleChange(null);
      }
    });
  };

  const renderRoleBadge = (role: unknown) => {
    const label = roleLabel(role);
    if (role === 'owner') {
      return (
        <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400">
          {label}
        </span>
      );
    }
    if (role === 'staff') {
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
          {label}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        {label}
      </span>
    );
  };

  return (
    <div className={cn('relative min-w-0 space-y-3', !embedded && 'rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs')}>
      <div className={embedded ? 'sr-only' : 'flex items-center justify-between'}>
        <div className="flex items-center gap-2">
          <UserCheck className="size-4 text-primary shrink-0" />
          <h3 className="text-sm font-bold text-foreground">Team Members ({members.length})</h3>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs font-semibold text-destructive">
          {error}
        </div>
      )}

      {/* Desktop Table (>= sm) */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[oklch(0.82_0.015_255)] text-muted-foreground font-semibold">
              <th className="py-2.5 pr-3">Name</th>
              <th className="py-2.5 pr-3">E-mail</th>
              <th className="py-2.5 pr-3">Role</th>
              <th className="py-2.5 pr-3">Joined</th>
              <th className="py-2.5 text-right w-24">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[oklch(0.82_0.015_255)]">
            {members.map((member) => {
              const displayName = member.name || member.email || 'Team member';
              const canManage = member.role !== 'owner' && !member.isYou;
              const joinedText = formatIstDate(member.createdAt, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });

              return (
                <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 pr-3 font-semibold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{displayName}</span>
                      {member.isYou && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                          You
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-muted-foreground">{member.email || '—'}</td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      {renderRoleBadge(member.role)}
                      {canManage && (
                        <select
                          aria-label={`Role for ${displayName}`}
                          value={member.role}
                          disabled={isPending}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (isOneOf(INVITABLE_ROLES, val) && val !== member.role) {
                              setPendingRoleChange({ member, newRole: val });
                            }
                          }}
                          className="h-6 rounded border border-border bg-background px-1.5 text-[11px] font-semibold text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="staff">Team member</option>
                          <option
                            value="accountant"
                            disabled={!canInviteAccountant && member.role !== 'accountant'}
                          >
                            Accountant (read-only)
                          </option>
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{joinedText}</td>
                  <td className="py-3 text-right">
                    {canManage && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setMemberToRemove(member)}
                        aria-label={`Remove ${member.name || member.email || "member"}`}
                        className="h-7 px-2 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards (< sm) */}
      <div className="sm:hidden space-y-2.5">
        {members.map((member) => {
          const displayName = member.name || member.email || 'Team member';
          const canManage = member.role !== 'owner' && !member.isYou;
          const joinedText = formatIstDate(member.createdAt, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });

          return (
            <div key={member.id} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 text-xs font-bold text-foreground [overflow-wrap:anywhere]">{displayName}</span>
                    {member.isYou && (
                      <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">{member.email || '—'}</p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {renderRoleBadge(member.role)}
                  {canManage && (
                    <select
                      aria-label={`Role for ${displayName}`}
                      value={member.role}
                      disabled={isPending}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (isOneOf(INVITABLE_ROLES, val) && val !== member.role) {
                          setPendingRoleChange({ member, newRole: val });
                        }
                      }}
                      className="h-6 rounded border border-border bg-background px-1.5 text-[11px] font-semibold text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="staff">Team member</option>
                      <option
                        value="accountant"
                        disabled={!canInviteAccountant && member.role !== 'accountant'}
                      >
                        Accountant (read-only)
                      </option>
                    </select>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[oklch(0.82_0.015_255)] text-[11px] text-muted-foreground">
                <span>Joined {joinedText}</span>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setMemberToRemove(member)}
                    aria-label={`Remove ${member.name || member.email || "member"}`}
                    className="h-6 px-2 text-xs font-semibold text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(memberToRemove)}
        onOpenChange={(open) => {
          if (!open && !isPending) setMemberToRemove(null);
        }}
        tone="destructive"
        title={`Remove ${memberToRemove?.name || memberToRemove?.email || 'this member'}?`}
        category="danger"
        icon={UserMinus}
        description="They lose access to this business immediately. Their account and everything they created stay."
        confirmLabel="Remove member"
        onConfirm={handleConfirmRemove}
      />

      {/* Role Change Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(pendingRoleChange)}
        onOpenChange={(open) => {
          if (!open && !isPending) setPendingRoleChange(null);
        }}
        title="Change role?"
        category="caution"
        icon={UserCog}
        description={`${pendingRoleChange?.member.name || pendingRoleChange?.member.email || 'This member'} will become ${pendingRoleChange ? roleLabel(pendingRoleChange.newRole) : ''}. This takes effect on their next page load.`}
        confirmLabel="Change role"
        onConfirm={handleConfirmRoleChange}
      />
    </div>
  );
}
