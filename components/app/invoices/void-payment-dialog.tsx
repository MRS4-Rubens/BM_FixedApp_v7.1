'use client';

import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { 
  ShieldAlert, 
  AlertTriangle, 
  X, 
  Loader2, 
  Ban, 
  Calendar, 
  CreditCard, 
  Hash 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPaiseAsInr } from '@/lib/money';
import { VOID_PAYMENT_REASONS, VoidPaymentReasonCode } from '@/lib/validations/payment';
import { voidPayment } from '@/lib/actions/payments/void-payment';
import { formatIstDate } from '@/lib/invoices/ist-date';

export interface VoidablePayment {
  id: string;
  amount_paise: number;
  payment_date: string | Date;
  payment_method: string;
  reference_number?: string | null;
  /** 'refund' = money paid back to the customer. Missing => 'payment'. */
  kind?: 'payment' | 'refund';
}

// Reasons that make sense for each kind of entry. A refund that bounced/failed is voided so the refund due returns.
const REFUND_REASON_CODES: readonly VoidPaymentReasonCode[] = ['refund_failed', 'clerical_error', 'wrong_invoice', 'other'];
const reasonsFor = (kind: 'payment' | 'refund') =>
  VOID_PAYMENT_REASONS.filter((r) => (kind === 'refund' ? REFUND_REASON_CODES.includes(r.code) : r.code !== 'refund_failed'));

interface VoidPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  payment: VoidablePayment | null;
  invoiceNumber: string;
  onSuccess?: () => void;
}

export function VoidPaymentDialog({
  isOpen,
  onClose,
  payment,
  invoiceNumber,
  onSuccess,
}: VoidPaymentDialogProps) {
  // The dialog is re-mounted per entry (key in PaymentSection), so the default reason follows the entry's kind.
  const kind = payment?.kind === 'refund' ? 'refund' : 'payment';
  const word = kind === 'refund' ? 'Refund' : 'Payment';
  const [reason, setReason] = useState<VoidPaymentReasonCode>(kind === 'refund' ? 'refund_failed' : 'clerical_error');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!payment) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (notes.trim().length < 3) {
      setError('Please provide an explanation of at least 3 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await voidPayment({
        id: payment.id,
        reason,
        notes: notes.trim(),
      });

      if (!res.success) {
        setError(res.error.message || `Failed to void ${word.toLowerCase()} record.`);
        setIsSubmitting(false);
        return;
      }

      onSuccess?.();
      onClose();
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedDate = payment.payment_date
    ? formatIstDate(payment.payment_date, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <Dialog.Popup className="relative w-full max-w-lg bg-card border border-border shadow-2xl rounded-2xl p-4 sm:p-5 text-foreground overflow-hidden max-h-[92dvh] overflow-y-auto">
            {/* Close Button */}
            <Dialog.Close
              render={
                <button
                  type="button"
                  disabled={isSubmitting}
                  aria-label="Close dialog"
                  className="absolute right-3.5 top-3.5 sm:right-4 sm:top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:pointer-events-none"
                >
                  <X className="size-4" />
                </button>
              }
            />

            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 shadow-xs">
                <ShieldAlert className="size-5" />
              </div>
              <div>
                <Dialog.Title
                  render={
                    <h2 className="text-[17px] font-bold text-foreground tracking-tight">
                      Void {word} Record
                    </h2>
                  }
                />
                <Dialog.Description
                  render={
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                      Invoice #{invoiceNumber} • Permanent Audit Trail Correction
                    </p>
                  }
                />
              </div>
            </div>

            {/* Payment Snapshot Card */}
            <div className="rounded-xl border border-border bg-muted/30 p-2.5 sm:px-3 sm:py-2.5 mb-3 space-y-1.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-border/60">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {word} Being Voided
                </span>
                <span className="text-[15px] font-bold text-red-700">
                  {formatPaiseAsInr(payment.amount_paise)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-0.5 text-xs">
                <div>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase">
                    <Calendar className="size-3.5" /> Date
                  </span>
                  <p className="font-semibold text-foreground mt-0.5">{formattedDate}</p>
                </div>
                <div>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase">
                    <CreditCard className="size-3.5" /> Method
                  </span>
                  <p className="font-semibold text-foreground capitalize mt-0.5">
                    {payment.payment_method.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase">
                    <Hash className="size-3.5" /> Reference
                  </span>
                  <p className="font-mono text-xs text-foreground truncate mt-0.5" title={payment.reference_number || undefined}>
                    {payment.reference_number || '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Statutory / Anti-Fraud Compliance Alert */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-3 flex items-start gap-2.5">
              <AlertTriangle className="size-[18px] shrink-0 text-amber-700 mt-0.5" />
              <div className="text-xs text-amber-900 leading-snug">
                <span className="font-bold">Permanent Audit Trail Notice:</span> {word} records cannot be erased. 
                This record will be permanently marked as <span className="font-bold">VOID</span> in the financial ledger with your user ID and timestamp. 
                {kind === 'refund' ? 'The refund due will return so the refund can be recorded again.' : 'The invoice balance will automatically revert.'}
              </div>
            </div>

            {/* Error Alert with live region */}
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 mb-3 text-xs font-medium text-red-700 flex items-center gap-2">
                <Ban className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Void Reason & Notes Form */}
            <form onSubmit={handleSubmit} className="space-y-2.5">
              <div>
                <label htmlFor="void-payment-reason" className="block text-xs font-bold text-foreground mb-1">
                  Reason for Voiding <span className="text-destructive">*</span>
                </label>
                <select
                  id="void-payment-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as VoidPaymentReasonCode)}
                  disabled={isSubmitting}
                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-[13px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs transition-colors cursor-pointer"
                >
                  {reasonsFor(kind).map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="void-payment-notes" className="block text-xs font-bold text-foreground">
                    Audit Notes / Explanation <span className="text-destructive">*</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">{notes.length}/300</span>
                </div>
                <textarea
                  id="void-payment-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 300))}
                  placeholder="e.g., Cheque returned unpaid by HDFC Bank on 24 Sep / Entry added to wrong customer account..."
                  disabled={isSubmitting}
                  rows={2}
                  required
                  className="w-full min-h-[64px] rounded-lg border border-border bg-background p-2 text-[13px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs transition-colors resize-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="h-8 px-3 text-[13px] font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={isSubmitting || notes.trim().length < 3}
                  className="h-8 px-3 text-[13px] font-bold gap-1.5 cursor-pointer shadow-xs whitespace-nowrap shrink-0 text-red-700"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin shrink-0" /> <span className="whitespace-nowrap">Voiding {word}...</span>
                    </>
                  ) : (
                    <>
                      <Ban className="size-4 shrink-0" /> <span className="whitespace-nowrap">Confirm &amp; Void {word}</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
