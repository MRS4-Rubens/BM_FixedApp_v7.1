'use client';

import { Dialog } from '@base-ui/react/dialog';
import { ModalHeader } from '@/components/ui/modal-header';
import { Loader2, XCircle, RefreshCw, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProofViewer } from './types';

interface ProofLightboxProps {
  proofViewer: ProofViewer | null;
  onClose: () => void;
  onRetry: (req: { id: string; businessName: string; paymentReference: string }) => void;
  onImageError: () => void;
}

export function ProofLightbox({
  proofViewer,
  onClose,
  onRetry,
  onImageError,
}: ProofLightboxProps) {
  return (
    <Dialog.Root
      open={!!proofViewer}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {proofViewer && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Popup data-viewport-dialog className="w-full max-w-3xl rounded-xl border border-border bg-card p-4 shadow-2xl relative max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in duration-200">
              <ModalHeader
                tone="tools"
                icon={ReceiptText}
                title={proofViewer?.title}
                description={`UTR: ${proofViewer?.utr ?? ''}`}
                closeLabel="Close proof viewer"
                className="-mx-4 -mt-4 mb-3 -top-4"
                actions={
                  proofViewer?.status === 'ready' ? (
                    <a
                      href={proofViewer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden sm:inline-flex rounded-md border border-border bg-card px-2.5 py-1 text-sm font-bold text-muted-foreground hover:text-indigo-600 hover:bg-muted transition"
                    >
                      Open Original ↗
                    </a>
                  ) : null
                }
              />

              {proofViewer?.status === 'loading' && (
                <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 py-12">
                  <Loader2 className="size-8 animate-spin text-indigo-600" />
                  <p className="text-sm font-semibold text-muted-foreground">Fetching secure link…</p>
                </div>
              )}

              {proofViewer?.status === 'error' && (
                <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 py-12 text-center px-4">
                  <div className="rounded-full bg-rose-500/10 p-3 text-rose-600">
                    <XCircle className="size-8" />
                  </div>
                  <div className="max-w-md">
                    <p className="text-sm font-bold text-foreground">Failed to load payment proof</p>
                    <p className="text-xs text-muted-foreground mt-1">{proofViewer.message}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onRetry({
                        id: proofViewer.requestId,
                        businessName: proofViewer.businessName,
                        paymentReference: proofViewer.utr,
                      })
                    }
                    className="font-bold cursor-pointer"
                  >
                    <RefreshCw className="size-3.5 mr-1.5" /> Try again
                  </Button>
                </div>
              )}

              {proofViewer?.status === 'ready' && (
                <div className="flex justify-center items-center max-h-[70vh] overflow-hidden rounded-lg bg-black/5 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proofViewer.url}
                    referrerPolicy="no-referrer"
                    alt="Payment proof screenshot"
                    onError={onImageError}
                    className="max-h-[65vh] w-auto object-contain rounded-md shadow-sm"
                  />
                </div>
              )}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

