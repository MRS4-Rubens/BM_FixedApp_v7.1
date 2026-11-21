'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteInvoiceDraft } from '@/lib/actions/invoices/delete-invoice-draft';

export interface DeleteDraftButtonProps {
  readonly invoiceId: string;
  readonly variant: 'icon' | 'button';
  readonly redirectTo?: string;
  readonly onError: (message: string) => void;
}

export function DeleteDraftButton({
  invoiceId,
  variant,
  redirectTo,
  onError,
}: DeleteDraftButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmDelete = async () => {
    startTransition(async () => {
      try {
        const result = await deleteInvoiceDraft({ id: invoiceId });
        if (!result.success) {
          const message = result.error.message || 'Failed to delete draft invoice.';
          onError(message);
          return;
        }

        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete draft invoice.';
        onError(message);
      }
    });
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          title="Delete draft invoice"
          aria-label="Delete draft invoice"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
          className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-red-700 shadow-sm disabled:opacity-50 cursor-pointer"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Delete draft invoice"
          aria-label="Delete draft invoice"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
          className="text-red-700 hover:bg-destructive/10 hover:text-red-700 cursor-pointer"
        >
          <Trash2 className="size-3.5 mr-1.5" />
          Delete Draft
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete draft invoice?"
        category="danger"
        icon={Trash2}
        description="Delete this draft invoice? This cannot be undone."
        confirmLabel="Delete draft"
        tone="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
