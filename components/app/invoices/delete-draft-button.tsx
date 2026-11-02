'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteInvoiceDraft } from '@/lib/actions/invoices/delete-invoice-draft';

export interface DeleteDraftButtonProps {
  readonly invoiceId: string;
  readonly variant: 'icon' | 'button';
  readonly redirectTo?: string;
  readonly onError?: (message: string) => void;
}

export function DeleteDraftButton({
  invoiceId,
  variant,
  redirectTo,
  onError,
}: DeleteDraftButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!window.confirm('Delete this draft invoice? This cannot be undone.')) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await deleteInvoiceDraft({ id: invoiceId });
        if (!result.success) {
          const message = result.error.message || 'Failed to delete draft invoice.';
          if (onError) {
            onError(message);
          } else {
            window.alert(message);
          }
          return;
        }

        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete draft invoice.';
        if (onError) {
          onError(message);
        } else {
          window.alert(message);
        }
      }
    });
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        title="Delete draft invoice"
        aria-label="Delete draft invoice"
        disabled={isPending}
        onClick={handleDelete}
        className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive shadow-sm disabled:opacity-50"
      >
        <Trash2 className="size-3.5" />
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Delete draft invoice"
      aria-label="Delete draft invoice"
      disabled={isPending}
      onClick={handleDelete}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-3.5 mr-1.5" />
      Delete Draft
    </Button>
  );
}

