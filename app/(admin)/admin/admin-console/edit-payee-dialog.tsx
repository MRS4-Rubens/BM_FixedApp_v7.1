'use client';

import { useState, type TransitionStartFunction } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { ModalHeader } from '@/components/ui/modal-header';
import { QrCode, CreditCard, Loader2, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updatePlatformPayeeAction } from '@/lib/actions/subscriptions/update-platform-payee';
import type { UpiConfig } from './types';

interface EditPayeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: UpiConfig | null;
  isPending?: boolean;
  startTransition?: TransitionStartFunction;
}

export function EditPayeeDialog({
  open,
  onOpenChange,
  currentConfig,
  isPending: externalPending,
  startTransition,
}: EditPayeeDialogProps) {
  const router = useRouter();
  const [localPending, setLocalPending] = useState(false);
  const isBusy = externalPending ?? localPending;
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    upiId: currentConfig?.upiId || '',
    upiName: currentConfig?.upiName || '',
    bankName: currentConfig?.bankName || '',
    accName: currentConfig?.accName || '',
    accNo: currentConfig?.accNo || '',
    ifsc: currentConfig?.ifsc || '',
  });
  const [accNoConfirm, setAccNoConfirm] = useState(currentConfig?.accNo || '');

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedAccNo = form.accNo.replace(/\s+/g, '');
    const cleanedConfirm = accNoConfirm.replace(/\s+/g, '');
    if (cleanedAccNo !== cleanedConfirm) {
      setError('Account numbers do not match.');
      return;
    }

    const runAction = async () => {
      const result = await updatePlatformPayeeAction({
        upiId: form.upiId.trim(),
        upiName: form.upiName.trim(),
        bankName: form.bankName.trim(),
        accName: form.accName.trim(),
        accNo: cleanedAccNo,
        ifsc: form.ifsc.trim().toUpperCase(),
      });

      if (result.success) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error?.message || 'Failed to update payee settings.');
      }
    };

    if (startTransition) {
      startTransition(runAction);
    } else {
      setLocalPending(true);
      runAction().finally(() => setLocalPending(false));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Dialog.Popup data-viewport-dialog className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl relative animate-in fade-in zoom-in duration-200 max-h-[92vh] overflow-y-auto">
            <ModalHeader
              tone="money"
              icon={QrCode}
              title="Edit Platform Payee Configuration"
              description="Update live UPI and Bank Account endpoints presented to subscribers on /checkout."
              closeLabel="Close payee settings"
              className="-mx-5 -mt-5 -top-5"
            />

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* UPI Section */}
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  <QrCode className="size-4" />
                  <span>Payee UPI Details (QR Codes & VPA)</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="payee-upi-id" className="text-xs font-bold text-muted-foreground uppercase">
                      Payee VPA / UPI ID *
                    </label>
                    <input
                      id="payee-upi-id"
                      type="text"
                      required
                      placeholder="e.g. business@okaxis"
                      value={form.upiId}
                      onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="payee-upi-name" className="text-xs font-bold text-muted-foreground uppercase">
                      Recipient Display Name *
                    </label>
                    <input
                      id="payee-upi-name"
                      type="text"
                      required
                      placeholder="e.g. Invoice BizFolio Billing"
                      value={form.upiName}
                      onChange={(e) => setForm({ ...form, upiName: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Bank Account Section */}
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  <CreditCard className="size-4" />
                  <span>Direct Bank Account Details (NEFT / IMPS)</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="payee-bank-name" className="text-xs font-bold text-muted-foreground uppercase">
                      Bank Name *
                    </label>
                    <input
                      id="payee-bank-name"
                      type="text"
                      required
                      placeholder="e.g. State Bank of India"
                      value={form.bankName}
                      onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="payee-acc-name" className="text-xs font-bold text-muted-foreground uppercase">
                      Account Name *
                    </label>
                    <input
                      id="payee-acc-name"
                      type="text"
                      required
                      placeholder="e.g. Invoice BizFolio Current A/C"
                      value={form.accName}
                      onChange={(e) => setForm({ ...form, accName: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="payee-acc-no" className="text-xs font-bold text-muted-foreground uppercase">
                      Account Number *
                    </label>
                    <input
                      id="payee-acc-no"
                      type="text"
                      required
                      placeholder="e.g. 10020030040"
                      value={form.accNo}
                      onChange={(e) => setForm({ ...form, accNo: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="payee-acc-no-confirm" className="text-xs font-bold text-muted-foreground uppercase">
                      Confirm Account Number *
                    </label>
                    <input
                      id="payee-acc-no-confirm"
                      type="text"
                      required
                      autoComplete="off"
                      onPaste={(e) => e.preventDefault()}
                      placeholder="Confirm account number"
                      value={accNoConfirm}
                      onChange={(e) => setAccNoConfirm(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <label htmlFor="payee-ifsc" className="text-xs font-bold text-muted-foreground uppercase">
                      IFSC Code *
                    </label>
                    <input
                      id="payee-ifsc"
                      type="text"
                      required
                      placeholder="e.g. SBIN0000952"
                      value={form.ifsc}
                      onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isBusy}
                  className="text-xs font-bold"
                >
                  Cancel
                </Button>

                <Button
                  type="submit"
                  disabled={isBusy}
                  className="btn-shine-indigo bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold gap-1.5 cursor-pointer"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="size-3.5" />
                      Save Payee Details
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
