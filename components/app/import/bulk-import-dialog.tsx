'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Lock, X } from 'lucide-react';
import type { ImportKind } from '@/lib/import/columns';
import {
  type BulkImportPreviewData,
  type ImportRunResult,
} from './bulk-import-helpers';
import { ImportUploadStep } from './import-upload-step';
import { ImportPreviewTable } from './import-preview-table';
import { ImportResultStep } from './import-result-step';

export type BulkImportStep = 'upload' | 'preview' | 'done';

export interface BulkImportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly kind: ImportKind;
  readonly canImport: boolean;
}

export function BulkImportDialog({
  open,
  onOpenChange,
  kind,
  canImport,
}: BulkImportDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<BulkImportStep>('upload');
  const [isRunning, setIsRunning] = useState(false);

  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [preview, setPreview] = useState<BulkImportPreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportRunResult | null>(null);

  const title = kind === 'customers' ? 'Import customers' : 'Import products';

  function resetState() {
    setStep('upload');
    setIsRunning(false);
    setFileName('');
    setFileBase64('');
    setPreview(null);
    setImportResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isRunning) return;
    if (!nextOpen) {
      const finishedImport = step === 'done';
      resetState();
      onOpenChange(false);
      if (finishedImport) router.refresh();
    } else {
      onOpenChange(true);
    }
  }

  function handleChecked(data: {
    readonly fileName: string;
    readonly fileBase64: string;
    readonly preview: BulkImportPreviewData;
  }) {
    setFileName(data.fileName);
    setFileBase64(data.fileBase64);
    setPreview(data.preview);
    setStep('preview');
  }

  function handleImportSuccess(result: ImportRunResult) {
    setImportResult(result);
    setStep('done');
  }

  function handleDone() {
    handleOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <Dialog.Popup
            aria-labelledby="bulk-import-dialog-title"
            className="relative w-full max-w-4xl bg-card border border-border shadow-2xl rounded-2xl p-5 sm:p-6 text-foreground overflow-hidden max-h-[92dvh] flex flex-col my-auto animate-in zoom-in-95 duration-150"
          >
            {/* Live region for accessibility */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {isRunning
                ? step === 'upload'
                  ? 'Checking file…'
                  : 'Importing…'
                : step === 'done'
                ? 'Import completed.'
                : ''}
            </div>

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <Dialog.Title
                id="bulk-import-dialog-title"
                className="text-xl font-extrabold tracking-tight text-foreground font-heading uppercase"
              >
                {title}
              </Dialog.Title>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => handleOpenChange(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              {!canImport ? (
                /* Plan Required State */
                <div className="py-8 px-4 text-center space-y-4">
                  <div className="mx-auto size-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shadow-xs">
                    <Lock className="size-6" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="text-base font-bold text-foreground">
                      Professional Plan Required
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Bulk import of customers and products is part of the Professional plan.
                    </p>
                  </div>
                  <div className="pt-2">
                    <Link
                      href="/settings?tab=Billing & Usage"
                      onClick={() => handleOpenChange(false)}
                      className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer"
                    >
                      See plans
                    </Link>
                  </div>
                </div>
              ) : (
                /* Multi-step Import Flow */
                <>
                  {step === 'upload' && (
                    <ImportUploadStep
                      kind={kind}
                      isRunning={isRunning}
                      setIsRunning={setIsRunning}
                      onChecked={handleChecked}
                    />
                  )}

                  {step === 'preview' && preview && (
                    <ImportPreviewTable
                      fileName={fileName}
                      fileBase64={fileBase64}
                      preview={preview}
                      isRunning={isRunning}
                      setIsRunning={setIsRunning}
                      onBack={() => {
                        setStep('upload');
                        setPreview(null);
                      }}
                      onSuccess={handleImportSuccess}
                    />
                  )}

                  {step === 'done' && importResult && (
                    <ImportResultStep
                      result={importResult}
                      onDone={handleDone}
                    />
                  )}
                </>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
