'use client';

import { useState } from 'react';
import {
  Upload,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Lock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { removeBusinessSignature } from '@/lib/actions/business/remove-signature';
import { SignatureUploadModal } from './signature-upload-modal';
import { SIGNATURE_UPLOAD_RULES, CROP_HOW_TO } from '@/lib/signature/upload-rules';

export interface SignaturePreviewCardProps {
  businessName: string;
  hasSignature: boolean;
  previewUri: string | null;
  className?: string;
  /** "lg" = roughly real print size (90 mm × 30 mm box), used on the modal's Confirm step. */
  size?: 'md' | 'lg';
}

/**
 * SignaturePreviewCard displays the official 3:1 authorised signatory box on a paper card.
 * Exported for reuse in the upload modal confirmation step.
 */
export function SignaturePreviewCard({
  businessName,
  hasSignature,
  previewUri,
  className,
  size = 'md',
}: SignaturePreviewCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-slate-200 bg-white p-3 shadow-2xs w-full sm:w-64 max-w-full flex flex-col justify-between select-none',
        className
      )}
    >
      {/* Top line: Business attribution */}
      <div className="text-[11px] font-semibold text-slate-700 truncate" title={`For ${businessName}`}>
        For {businessName}
      </div>

      {/* Middle: Signature graphic, hand-sign dashed line, or preview placeholder */}
      <div className={cn('flex items-center justify-center my-1', size === 'lg' ? 'h-24' : 'h-14')}>
        {hasSignature && previewUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUri}
            alt="Authorised signature preview"
            className={cn('max-w-full object-contain pointer-events-none', size === 'lg' ? 'max-h-24' : 'max-h-14')}
            draggable={false}
          />
        ) : hasSignature && !previewUri ? (
          <p className="text-center text-[11px] text-muted-foreground leading-tight px-1">
            Preview unavailable — the signature is still saved.
          </p>
        ) : (
          <div className="w-full flex items-end justify-center h-full pb-1">
            <div className="w-40 border-b border-dashed border-slate-400" />
          </div>
        )}
      </div>

      {/* Bottom: Statutory label */}
      <div className="border-t border-slate-300 pt-0.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Authorised Signatory
        </p>
      </div>
    </div>
  );
}

export interface SignatureSettingsPanelProps {
  businessName: string;
  hasSavedSignature: boolean;
  initialPreviewDataUri: string | null;
  canManage: boolean;
  disabledReason: string | null;
}

export function SignatureSettingsPanel({
  businessName,
  hasSavedSignature,
  initialPreviewDataUri,
  canManage,
  disabledReason,
}: SignatureSettingsPanelProps) {
  const [hasSignature, setHasSignature] = useState(hasSavedSignature);
  const [previewUri, setPreviewUri] = useState<string | null>(initialPreviewDataUri);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // Awaited directly (not via startTransition) so ConfirmDialog stays open and busy until the server answers.
  const handleRemove = async () => {
    setErrorMessage(null);
    setIsRemoving(true);
    try {
      const result = await removeBusinessSignature({});
      if (result.success) {
        setHasSignature(false);
        setPreviewUri(null);
        setSuccessMessage('Signature removed.');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setErrorMessage(result.error.message);
      }
    } finally {
      setIsRemoving(false);
    }
  };
  const isPending = isRemoving;

  const handleSaved = (dataUrl: string) => {
    setHasSignature(true);
    setPreviewUri(dataUrl);
    setErrorMessage(null);
    setSuccessMessage('Signature saved. It will appear on new invoices.');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const renderActionButton = (button: React.ReactElement) => {
    if (canManage || !disabledReason) {
      return button;
    }
    return (
      <Tooltip content={disabledReason}>
        <span className="inline-block cursor-not-allowed">{button}</span>
      </Tooltip>
    );
  };

  return (
    <>
      {/* flex-wrap: the preview drops below the text whenever the column is too narrow for both. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left side: Status & Actions */}
        <div className="space-y-2 flex-1 min-w-56">
          <div>
            {hasSignature ? (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <h4 className="text-sm sm:text-base font-semibold text-slate-900">
                  Signature on file
                </h4>
              </div>
            ) : (
              <h4 className="text-sm sm:text-base font-semibold text-slate-900">
                No signature uploaded
              </h4>
            )}
            <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {hasSignature
                ? 'Saved straight away. Invoices already issued keep the signature they were issued with.'
                : 'Invoices will print a blank line so you can sign by hand.'}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {hasSignature ? (
              <>
                {renderActionButton(
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canManage || isPending}
                    onClick={() => setModalOpen(true)}
                    className="cursor-pointer gap-1.5 text-xs font-semibold"
                  >
                    <RefreshCw className="size-3.5" />
                    <span>Replace</span>
                  </Button>
                )}
                {renderActionButton(
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canManage || isPending}
                    onClick={() => setConfirmOpen(true)}
                    className="cursor-pointer gap-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Remove</span>
                  </Button>
                )}
              </>
            ) : (
              renderActionButton(
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={!canManage || isPending}
                  onClick={() => setModalOpen(true)}
                  className="cursor-pointer gap-1.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-900 text-white shadow-xs"
                >
                  <Upload className="size-3.5" />
                  <span>Upload signature</span>
                </Button>
              )
            )}
          </div>

          {/* Signature rules */}
          <div className="pt-1">
            <p className="text-xs font-semibold text-slate-700">Signature rules</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {SIGNATURE_UPLOAD_RULES.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2 className="size-3 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-amber-800">
              How to crop a photo on your phone or computer
            </summary>
            <div className="mt-1 space-y-1 text-muted-foreground pl-2 border-l border-amber-200">
              {CROP_HOW_TO.map((item, idx) => (
                <p key={idx}>
                  <strong className="text-slate-700">{item.device}:</strong> {item.steps}
                </p>
              ))}
            </div>
          </details>

          {!canManage && disabledReason && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground pt-0.5">
              <Lock className="size-3 shrink-0" />
              <span>{disabledReason}</span>
            </p>
          )}

          {/* Feedback messages */}
          {successMessage && (
            <p role="status" className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>{successMessage}</span>
            </p>
          )}
          {errorMessage && (
            <p role="alert" className="text-xs font-semibold text-destructive flex items-center gap-1">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </p>
          )}
        </div>

        {/* Right side: Live Preview Card */}
        <div className="min-w-0 max-w-full w-full sm:w-auto flex justify-center sm:justify-end">
          <SignaturePreviewCard
            businessName={businessName}
            hasSignature={hasSignature}
            previewUri={previewUri}
          />
        </div>
      </div>

      {/* Remove Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove signature?"
        description="New invoices will print a blank line for a hand signature. Invoices and credit notes already finalised keep the signature they were issued with."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={handleRemove}
      />

      {/* Upload & Adjust Modal */}
      <SignatureUploadModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        businessName={businessName}
        onSaved={handleSaved}
      />
    </>
  );
}
