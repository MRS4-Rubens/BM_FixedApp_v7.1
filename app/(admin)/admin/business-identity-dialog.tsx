'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ModalHeader } from '@/components/ui/modal-header';
import { FileWarning } from 'lucide-react';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { adminUpdateBusinessIdentity } from '@/lib/actions/business/admin-update-business-identity';
import { correctedGstinSchema } from '@/lib/validations/admin-business-identity';

const inputClass = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 read-only:bg-slate-50 read-only:text-slate-600';

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
  const [legalName, setLegalName] = useState(business?.legalName ?? '');
  const [editGstin, setEditGstin] = useState(false);
  const [editLegalName, setEditLegalName] = useState(false);
  const [stale, setStale] = useState(false);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  if (business?.id !== prevProps.id || open !== prevProps.open) {
    setPrevProps({ id: business?.id, open });
    setGstin(business?.gstin ?? '');
    setLegalName(business?.legalName ?? '');
    setEditGstin(false);
    setEditLegalName(false);
    setStale(false);
    setReason('');
    setFormError(null);
    setFieldErrors({});
  }

  if (!business) return null;

  const gstinChanged = editGstin && gstin.trim() !== business.gstin;
  const legalNameChanged = editLegalName && legalName.trim() !== business.legalName.trim();
  const parsedGstin = correctedGstinSchema.safeParse(gstin);
  const stateCode = gstinChanged && parsedGstin.success ? parsedGstin.data.slice(0, 2) : business.stateCode;
  const stateName = INDIAN_GST_STATES.find(({ code }) => code === stateCode)?.name ?? stateCode;
  const canSave = !isPending && !stale && (gstinChanged || legalNameChanged) &&
    (!gstinChanged || parsedGstin.success) &&
    (!legalNameChanged || legalName.trim().length > 0) && reason.trim().length >= 10;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSave) return;
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await adminUpdateBusinessIdentity({
        business_id: business.id,
        ...(gstinChanged ? { gstin: { previous: business.gstin, value: gstin.trim() } } : {}),
        ...(legalNameChanged ? { legal_name: { previous: business.legalName, value: legalName.trim() } } : {}),
        reason: reason.trim(),
      });

      if (result.success) {
        onSaved();
        onOpenChange(false);
      } else {
        setFormError(result.error.message);
        if (result.error.code === 'STALE_IDENTITY') {
          setStale(true);
        }
        if (result.error.fieldErrors) {
          setFieldErrors(result.error.fieldErrors);
        }
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Dialog.Popup data-viewport-dialog data-form-dialog-frame className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl relative animate-in fade-in zoom-in duration-200 max-h-[92vh] overflow-y-auto text-slate-900">
            <ModalHeader
              tone="caution"
              icon={FileWarning}
              title="Correct Business Identity"
              description="Recorded in the audit log with your reason"
              closeLabel="Close business identity correction"
              closeDisabled={isPending}
              className="-mx-5 -mt-5 shrink-0 -top-5"
            />
            <p className="text-xs text-slate-600 mt-3 mb-4 leading-relaxed">
              {business.legalName}. Select the fields you want to correct for this business.
            </p>

            <form data-complex-dialog-form onSubmit={handleSubmit} className="space-y-4">
<div data-dialog-body><div data-desktop-canvas data-modal-canvas className="space-y-4" style={{ minWidth: '472px' }}>

              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
                >
                  {formError}
                  {stale && (
                    <button type="button" onClick={onSaved} className="ml-2 font-bold underline">
                      Reload business
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Edit legal name"
                    checked={editLegalName}
                    disabled={isPending || stale}
                    onChange={(event) => {
                      setEditLegalName(event.target.checked);
                      setLegalName(business.legalName);
                      setFieldErrors((errors) => ({ ...errors, legal_name: undefined }));
                      setFormError(null);
                    }}
                  />
                  <label htmlFor="identity-legal-name" className="text-xs font-bold text-slate-700">Legal Name</label>
                </div>
                <input
                  id="identity-legal-name"
                  value={legalName}
                  onChange={(event) => setLegalName(event.target.value)}
                  maxLength={200}
                  readOnly={!editLegalName || stale}
                  disabled={isPending}
                  aria-invalid={!!fieldErrors.legal_name?.length}
                  aria-describedby={fieldErrors.legal_name?.length ? 'identity-name-error' : undefined}
                  className={inputClass}
                />
                {fieldErrors.legal_name?.length ? (
                  <p id="identity-name-error" className="text-xs font-medium text-rose-700">{fieldErrors.legal_name[0]}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Edit GSTIN"
                    checked={editGstin}
                    disabled={isPending || stale}
                    onChange={(event) => {
                      setEditGstin(event.target.checked);
                      setGstin(business.gstin);
                      setFieldErrors((errors) => ({ ...errors, gstin: undefined }));
                      setFormError(null);
                    }}
                  />
                <label
                  htmlFor="identity-gstin"
                  className="text-xs font-bold text-slate-700"
                >
                  GSTIN
                </label>
                </div>
                <input
                  id="identity-gstin"
                  type="text"
                  value={gstin}
                  onChange={(event) => {
                    setGstin(event.target.value.toUpperCase());
                    setFieldErrors((errors) => ({ ...errors, gstin: undefined }));
                  }}
                  maxLength={15}
                  aria-invalid={!!fieldErrors.gstin?.length || (gstinChanged && !parsedGstin.success)}
                  aria-describedby={fieldErrors.gstin?.length || (gstinChanged && !parsedGstin.success) ? 'identity-gstin-error' : undefined}
                  className={`${inputClass} font-mono uppercase`}
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  disabled={isPending}
                  readOnly={!editGstin || stale}
                />
                {fieldErrors.gstin?.length || (gstinChanged && !parsedGstin.success) ? (
                  <p id="identity-gstin-error" className="text-xs font-medium text-rose-700 mt-1">
                    {fieldErrors.gstin?.[0] ?? parsedGstin.error?.issues[0]?.message}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0 space-y-1">
                <div id="identity-state-label" className="flex min-h-4 items-center text-xs font-bold text-slate-700">
                  Registered State
                </div>
                <div
                  role="status"
                  aria-labelledby="identity-state-label"
                  title={stateName}
                  className="h-9 truncate rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-sm leading-9 text-slate-600"
                >
                  {stateName}
                </div>
              </div>
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
                  placeholder="Enter the reason or support ticket reference."
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

              
</div></div>
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
                  disabled={!canSave}
                  className="btn-shine-indigo px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isPending ? 'Saving…' : 'Save corrections'}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

