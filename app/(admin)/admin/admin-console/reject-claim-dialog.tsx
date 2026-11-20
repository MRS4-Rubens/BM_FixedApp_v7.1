'use client';

import { useState, type TransitionStartFunction } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { processSubscriptionClaim } from '@/lib/actions/subscriptions/process-request';
import type { PendingRequestItem } from './types';

interface RejectClaimDialogProps {
  rejectingClaim: PendingRequestItem | null;
  onClose: () => void;
  /** Shared admin-console transition (see use-claim-actions). */
  isPending: boolean;
  startTransition: TransitionStartFunction;
}

export function RejectClaimDialog({
  rejectingClaim,
  onClose,
  isPending,
  startTransition,
}: RejectClaimDialogProps) {
  const router = useRouter();
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const handleClose = () => {
    setRejectReason('');
    setRejectError(null);
    onClose();
  };

  const handleRejectSubmit = () => {
    if (!rejectingClaim) return;
    if (!rejectReason.trim()) {
      setRejectError('Please specify a rejection reason for the client.');
      return;
    }

    startTransition(async () => {
      const result = await processSubscriptionClaim({
        request_id: rejectingClaim.id,
        action: 'reject',
        reject_reason: rejectReason.trim(),
      });

      if (result.success) {
        handleClose();
        router.refresh();
      } else {
        setRejectError(result.error?.message || 'Failed to reject claim.');
      }
    });
  };

  return (
    <Dialog.Root
      open={!!rejectingClaim}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      {rejectingClaim && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Popup data-viewport-dialog className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl relative animate-in fade-in zoom-in duration-200">
              <Dialog.Title
                render={
                  <h3 className="text-lg font-bold text-foreground font-heading border-b border-border/40 pb-3 flex items-center gap-2">
                    <XCircle className="size-5 text-rose-600" /> Reject Payment Claim
                  </h3>
                }
              />
              <Dialog.Description
                render={
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    Claim for <b className="text-foreground">{rejectingClaim.businessName}</b> (UTR:{' '}
                    <span className="font-mono text-indigo-600 font-bold">{rejectingClaim.paymentReference}</span>).
                    Please provide a clear rejection reason.
                  </p>
                }
              />

              {/* Reason presets */}
              <div className="mt-3.5 space-y-1.5">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Quick Reason Presets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'UTR not found in bank statement',
                    'Payment amount does not match plan price',
                    'Duplicate transaction reference submitted',
                    'Unreadable payment screenshot proof',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setRejectReason(chip);
                        if (rejectError) setRejectError(null);
                      }}
                      className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-indigo-50 hover:text-indigo-600 transition cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3.5 flex flex-col gap-1">
                <label htmlFor="reject_reason" className="text-sm font-bold text-foreground">
                  Rejection Note *
                </label>
                <textarea
                  id="reject_reason"
                  rows={3}
                  placeholder="State why the claim was not approved..."
                  value={rejectReason}
                  aria-invalid={rejectError ? 'true' : undefined}
                  onChange={(e) => {
                    setRejectReason(e.target.value);
                    if (rejectError) setRejectError(null);
                  }}
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-sm font-medium outline-none transition focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                />
              </div>

              {rejectError && (
                <p role="alert" className="mt-1 text-xs text-destructive font-medium">
                  {rejectError}
                </p>
              )}

              <div data-modal-footer className="mt-5 flex justify-end gap-2.5">
                <Button
                  variant="ghost"
                  disabled={isPending}
                  onClick={handleClose}
                  className="text-sm font-bold"
                >
                  Cancel
                </Button>
                <Button
                  disabled={isPending}
                  onClick={handleRejectSubmit}
                  className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirm Rejection'}
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

