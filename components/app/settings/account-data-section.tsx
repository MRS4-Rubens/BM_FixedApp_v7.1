'use client';

import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ModalHeader } from '@/components/ui/modal-header';
import { AlertTriangle, CheckCircle2, DoorClosed, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestAccountClosureAction } from '@/lib/actions/account/request-account-closure';
import { SettingsSectionBadge } from './settings-section-badge';

/**
 * OPT-002a: General-tab account section — DPDP data export and the recorded account-closure request.
 * Nothing is deleted automatically; support processes the request (docs/DEPLOYMENT.md runbook).
 */
export function AccountDataSection({ isOwner }: { isOwner: boolean }) {
  const [closureDialogOpen, setClosureDialogOpen] = useState(false);
  const [confirmationGstin, setConfirmationGstin] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [closureError, setClosureError] = useState<string | null>(null);
  const [isClosurePending, setIsClosurePending] = useState(false);
  const [closureSuccessDate, setClosureSuccessDate] = useState<string | null>(null);

  const handleClosureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationGstin.trim()) return;

    setIsClosurePending(true);
    setClosureError(null);
    try {
      const res = await requestAccountClosureAction({
        confirmation_gstin: confirmationGstin.trim(),
        reason: closureReason.trim() || undefined,
      });

      if (res.success) {
        setClosureDialogOpen(false);
        setConfirmationGstin('');
        setClosureReason('');
        setClosureSuccessDate(res.data.requestedAt);
      } else {
        const fieldError =
          res.error.fieldErrors?.confirmation_gstin?.[0] ||
          res.error.fieldErrors?.reason?.[0];
        setClosureError(fieldError || res.error.message || 'Failed to submit account closure request.');
      }
    } catch (err: unknown) {
      setClosureError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsClosurePending(false);
    }
  };

  return (
    <>
    {/* Download your data card */}
    <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
      {/* UI stage 1: the action sits beside the heading it belongs to, top-aligned, instead of on its own line. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <SettingsSectionBadge number={2} tone="amber" />
            <h3 className="text-xl font-bold font-heading text-foreground uppercase">Download your data</h3>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground font-medium">
            A JSON file with your business profile, customers, products, invoices, credit notes, payments and subscription history.
          </p>
        </div>
        {isOwner && (
          <a
            href="/api/account/export"
            download
            className="btn-shine-navy inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap cursor-pointer"
          >
            <Download className="size-4 shrink-0" aria-hidden="true" />
            Download your data
          </a>
        )}
      </div>
      {!isOwner && (
        <p className="mt-3 text-sm text-muted-foreground italic">
          Only the business owner can download the account data.
        </p>
      )}
    </div>

    {/* Danger Zone card (owner only) */}
    {isOwner && (
      <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
        <div className="mb-3 flex items-center gap-2">
          <SettingsSectionBadge number={3} tone="rose" />
          <h3 className="text-xl font-bold font-heading text-foreground uppercase">Close account</h3>
        </div>

        {closureSuccessDate && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span>Closure request received on {closureSuccessDate}. Our team will contact you within 30 days.</span>
          </div>
        )}

        <div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-base font-bold text-foreground">Close Business Account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We close the workspace within 30 days and erase data we are not required to keep. GST records stay
            archived for their legal retention period.
            </p>
            <button
              type="button"
              onClick={() => {
                setClosureError(null);
                setClosureDialogOpen(true);
              }}
              className="mt-3 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-bold text-red-700 transition-colors hover:bg-destructive/10 cursor-pointer shadow-xs"
            >
              Request account closure
            </button>
          </div>
        </div>
      </div>
    )}

    <Dialog.Root
      open={closureDialogOpen}
      onOpenChange={(open) => {
        if (!open && !isClosurePending) {
          setClosureDialogOpen(false);
          setClosureError(null);
          setConfirmationGstin('');
          setClosureReason('');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <Dialog.Popup data-viewport-dialog data-form-dialog-frame className="relative w-full max-w-lg bg-card border border-border shadow-2xl rounded-2xl p-5 text-foreground overflow-hidden max-h-[92dvh] overflow-y-auto">
            <ModalHeader
              tone="danger"
              icon={DoorClosed}
              title="Request account closure"
              description="Your workspace closes within 30 days"
              closeLabel="Close account closure"
              closeDisabled={isClosurePending}
              className="-mx-5 -mt-5 shrink-0 -top-5"
            />
            {/* UI stage 1: the danger warning lives in the dialog, right before the details it asks you to read. */}
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-red-700 whitespace-nowrap">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <strong className="font-bold uppercase tracking-wide">Danger Zone</strong>
              <span aria-hidden="true">·</span>
              <span>Please read this before sending a closure request.</span>
            </p>
            <p className="mt-2 mb-4 text-sm text-muted-foreground leading-relaxed">
                    We will close your workspace within 30 days and erase data we are not required to keep. Invoices, credit notes, payment records and the business and customer details on them must be kept for 8 years after the end of their financial year under Indian GST and tax law; they stay locked in our archive and are deleted after that period. Download your data first if you need a copy.
                  </p>

            {closureError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm font-semibold text-red-700 flex items-start gap-2"
              >
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{closureError}</span>
              </div>
            )}

            <form data-complex-dialog-form onSubmit={handleClosureSubmit} className="space-y-4">
<div data-dialog-body><div data-desktop-canvas data-modal-canvas style={{ minWidth: '472px' }}>

              <div>
                <label
                  htmlFor="closure-confirm-gstin"
                  className="block text-xs font-bold uppercase tracking-wider text-foreground mb-1.5"
                >
                  Type your GSTIN to confirm <span className="text-destructive">*</span>
                </label>
                <input
                  id="closure-confirm-gstin"
                  type="text"
                  value={confirmationGstin}
                  onChange={(e) => setConfirmationGstin(e.target.value.toUpperCase())}
                  placeholder="27AAPFU0939F1ZV"
                  disabled={isClosurePending}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm uppercase text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="closure-reason"
                    className="block text-xs font-bold uppercase tracking-wider text-foreground"
                  >
                    Reason (optional)
                  </label>
                  <span className="text-[11px] text-muted-foreground">{closureReason.length}/500</span>
                </div>
                <textarea
                  id="closure-reason"
                  value={closureReason}
                  onChange={(e) => setClosureReason(e.target.value.slice(0, 500))}
                  placeholder="Tell us why you are leaving..."
                  disabled={isClosurePending}
                  rows={3}
                  className="w-full min-h-[72px] rounded-lg border border-border bg-background p-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs transition-colors resize-none"
                />
              </div>

              
</div></div>
<div data-modal-footer className="flex items-center justify-end gap-2.5 pt-3 border-t border-[oklch(0.82_0.015_255)]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setClosureDialogOpen(false);
                    setClosureError(null);
                    setConfirmationGstin('');
                    setClosureReason('');
                  }}
                  disabled={isClosurePending}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={isClosurePending || !confirmationGstin.trim()}
                  className="font-bold gap-1.5 cursor-pointer shadow-xs text-red-700"
                >
                  {isClosurePending ? (
                    <>
                      <Loader2 className="size-4 animate-spin shrink-0" />
                      <span>Sending request...</span>
                    </>
                  ) : (
                    <span>Send closure request</span>
                  )}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
}
