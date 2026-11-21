'use client';

import * as React from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, FileCheck2, Loader2, type LucideIcon } from 'lucide-react';
import { ModalHeader, type ModalTone } from '@/components/ui/modal-header';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Button style: 'destructive' = red confirm button and focus starts on Cancel. */
  tone?: 'default' | 'destructive';
  /** Header colour group. Defaults: destructive -> 'danger', default -> 'document'. */
  category?: ModalTone;
  /** Header icon. Defaults to a warning sign (danger) or a document tick. */
  icon?: LucideIcon;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  category,
  icon,
  onConfirm,
}: ConfirmDialogProps) {
  const headerTone: ModalTone = category ?? (tone === 'destructive' ? 'danger' : 'document');
  const headerIcon = icon ?? (headerTone === 'danger' || headerTone === 'caution' ? AlertTriangle : FileCheck2);
  const [isPending, setIsPending] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  const handleConfirm = async () => {
    try {
      setIsPending(true);
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Errors should be handled by caller; keep open if failed
    } finally {
      setIsPending(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <AlertDialog.Popup data-viewport-dialog
            initialFocus={tone === 'destructive' ? cancelRef : confirmRef}
            className="relative w-full max-w-md bg-card border border-border shadow-2xl rounded-2xl text-foreground overflow-hidden max-h-[92dvh] overflow-y-auto animate-in zoom-in-95 duration-150"
          >
            <ModalHeader tone={headerTone} icon={headerIcon} title={title} closeDisabled={isPending} />
            <div className="px-5 pt-4 pb-5">
            <AlertDialog.Description render={<div className="text-sm text-muted-foreground leading-relaxed" />}>
              {description}
            </AlertDialog.Description>
            <div data-modal-footer className="mt-6 flex items-center justify-end gap-2.5">
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                {cancelLabel}
              </Button>
              <Button
                ref={confirmRef}
                type="button"
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                size="sm"
                disabled={isPending}
                onClick={handleConfirm}
                className={tone === 'destructive' ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700' : ''}
              >
                {isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {confirmLabel}
              </Button>
            </div>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
