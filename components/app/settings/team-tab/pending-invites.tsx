'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, Clock, Loader2, Mail, MailX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { resendTeamInvite } from '@/lib/actions/team/resend-team-invite';
import { revokeTeamInvite } from '@/lib/actions/team/revoke-team-invite';
import { roleLabel } from '@/components/app/current-user-role';
import type { TeamInvite, InviteLinkResult } from './types';

export interface PendingInvitesProps {
  invites: TeamInvite[];
  onResendSuccess: (result: InviteLinkResult) => void;
  onInviteRevoked: () => void;
}

export function PendingInvites({
  invites,
  onResendSuccess,
  onInviteRevoked,
}: PendingInvitesProps) {
  const [inviteToRevoke, setInviteToRevoke] = useState<TeamInvite | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);
  const [cooldownMessage, setCooldownMessage] = useState<{ id: string; text: string } | null>(null);

  const handleResend = (invite: TeamInvite) => {
    setCooldownMessage(null);
    setActiveInviteId(invite.id);
    startTransition(async () => {
      const result = await resendTeamInvite({ invitation_id: invite.id });
      setActiveInviteId(null);
      if (result.success) {
        onResendSuccess(result.data);
      } else {
        setCooldownMessage({ id: invite.id, text: result.error.message });
      }
    });
  };

  const handleConfirmRevoke = async () => {
    if (!inviteToRevoke) return;
    startTransition(async () => {
      const result = await revokeTeamInvite({ invitation_id: inviteToRevoke.id });
      if (result.success) {
        setInviteToRevoke(null);
        onInviteRevoked();
      } else {
        setCooldownMessage({ id: inviteToRevoke.id, text: result.error.message });
      }
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="size-4 text-primary shrink-0" />
        <h3 className="text-sm font-bold text-foreground">Pending Invitations ({invites.length})</h3>
      </div>

      {invites.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No pending invites.</p>
      ) : (
        <div className="space-y-2.5">
          {invites.map((invite) => {
            const isTargetPending = isPending && activeInviteId === invite.id;
            const sentText = formatIstDate(invite.sentAt, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            const expiresText = formatIstDate(invite.expiresAt, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });

            return (
              <div
                key={invite.id}
                className="rounded-lg border border-border p-3 space-y-2 bg-muted/20"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold font-mono text-foreground">{invite.email}</span>
                      <span
                        className={
                          invite.role === 'staff'
                            ? 'inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400'
                            : 'inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }
                      >
                        {roleLabel(invite.role)}
                      </span>
                      {invite.isExpired ? (
                        <span className="inline-flex items-center rounded-full bg-rose-500/10 border border-rose-300 dark:border-rose-900 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                          Expires {expiresText}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" />
                      <span>Sent {sentText}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleResend(invite)}
                      className="h-7 text-xs font-semibold gap-1"
                    >
                      {isTargetPending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      <span>Resend</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setInviteToRevoke(invite)}
                      className="h-7 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <span>Cancel</span>
                    </Button>
                  </div>
                </div>

                {cooldownMessage && cooldownMessage.id === invite.id && (
                  <div role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-destructive pt-1 border-t border-border/40">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>{cooldownMessage.text}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(inviteToRevoke)}
        onOpenChange={(open) => {
          if (!open && !isPending) setInviteToRevoke(null);
        }}
        tone="destructive"
        title={`Cancel invite for ${inviteToRevoke?.email}?`}
        category="danger"
        icon={MailX}
        description="The invite link will stop working immediately."
        confirmLabel="Cancel invite"
        onConfirm={handleConfirmRevoke}
      />
    </div>
  );
}
