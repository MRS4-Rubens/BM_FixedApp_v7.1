'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { adminUpdateBusinessIdentity } from '@/lib/actions/business/admin-update-business-identity';

export interface BusinessIdentityDialogProps {
  business: { id: string; legalName: string; gstin: string; stateCode: string } | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(): void;
}

export function BusinessIdentityDialog({
  business,
  open,
  onOpenChange,
  onSaved,
}: BusinessIdentityDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [prevProps, setPrevProps] = useState<{ id?: string; open?: boolean }>({});
  const [gstin, setGstin] = useState(business?.gstin ?? '');
  const [stateCode, setStateCode] = useState(business?.stateCode ?? '');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  if (business?.id !== prevProps.id || open !== prevProps.open) {
    setPrevProps({ id: business?.id, open });
    setGstin(business?.gstin ?? '');
    setStateCode(business?.stateCode ?? '');
    setReason('');
    setFormError(null);
    setFieldErrors({});
  }

  if (!business) return null;

  const handleGstinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setGstin(val);
    if (val.length >= 2) {
      const prefix = val.slice(0, 2);
      if (INDIAN_GST_STATES.some((s) => s.code === prefix)) {
        setStateCode(prefix);
      }
    }
  };

  const handleStateCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCode = e.target.value;
    setStateCode(newCode);
    if (gstin.length >= 2) {
      setGstin(newCode + gstin.slice(2));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await adminUpdateBusinessIdentity({
        business_id: business.id,
        gstin: gstin.trim().toUpperCase(),
        state_code: stateCode,
        reason: reason.trim(),
      });

      if (result.success) {
        onSaved();
        onOpenChange(false);
      } else {
        setFormError(result.error.message);
        if (result.error.fieldErrors) {
          setFieldErrors(result.error.fieldErrors);
        }
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Dialog.Popup data-viewport-dialog className="[--modal-footer-bg:#fff] w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl relative animate-in fade-in zoom-in duration-200 max-h-[min(92vh,100dvh_-_24px_-_env(safe-area-inset-top,0px)_-_env(safe-area-inset-bottom,0px))] overflow-y-auto text-slate-900">
            <Dialog.Close
              render={
                <button
                  type="button"
                  aria-label="Close modal"
                  disabled={isPending}
                  className="absolute top-4 right-4 text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <X className="size-5" />
                </button>
              }
            />

            <Dialog.Title
              render={
                <h3 className="text-lg font-bold text-slate-900 font-heading border-b border-slate-200 pb-2">
                  Correct GSTIN / state
                </h3>
              }
            />

            <Dialog.Description
              render={
                <p className="text-xs text-slate-600 mt-2 mb-4 leading-relaxed">
                  Use only when the business has asked support to correct its registered GSTIN or state. The change is recorded in the audit log with your reason.
                </p>
              }
            />

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
                >
                  {formError}
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="identity-gstin"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
                >
                  GSTIN
                </label>
                <input
                  id="identity-gstin"
                  type="text"
                  value={gstin}
                  onChange={handleGstinChange}
                  maxLength={15}
                  aria-invalid={!!fieldErrors.gstin?.length}
                  aria-describedby={fieldErrors.gstin?.length ? 'identity-gstin-error' : undefined}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-sm font-semibold uppercase text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  disabled={isPending}
                />
                {fieldErrors.gstin?.length ? (
                  <p id="identity-gstin-error" className="text-xs font-medium text-rose-700 mt-1">
                    {fieldErrors.gstin[0]}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="identity-state"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
                >
                  Registered State
                </label>
                <select
                  id="identity-state"
                  value={stateCode}
                  onChange={handleStateCodeChange}
                  aria-invalid={!!fieldErrors.state_code?.length}
                  aria-describedby={fieldErrors.state_code?.length ? 'identity-state-error' : undefined}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  disabled={isPending}
                >
                  <option value="">Select a state</option>
                  {INDIAN_GST_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.state_code?.length ? (
                  <p id="identity-state-error" className="text-xs font-medium text-rose-700 mt-1">
                    {fieldErrors.state_code[0]}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="identity-reason"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
                >
                  Reason for Correction
                </label>
                <textarea
                  id="identity-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={500}
                  rows={3}
                  required
                  aria-invalid={!!fieldErrors.reason?.length}
                  aria-describedby={fieldErrors.reason?.length ? 'identity-reason-error' : 'identity-reason-helper'}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  placeholder="Provide the context or ticket reference for this GSTIN or state update (min 10 characters)..."
                  disabled={isPending}
                />
                <p id="identity-reason-helper" className="text-xs text-slate-600 mt-1">
                  Minimum 10 characters, maximum 500 characters. Explain why this correction was requested.
                </p>
                {fieldErrors.reason?.length ? (
                  <p id="identity-reason-error" className="text-xs font-medium text-rose-700 mt-1">
                    {fieldErrors.reason[0]}
                  </p>
                ) : null}
              </div>

              <div data-modal-footer className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isPending ? 'Saving…' : 'Save correction'}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

