'use client';

import { History, X } from 'lucide-react';
import { formatIstTime } from '@/lib/invoices/ist-date';

/** Shown on New Invoice when an unsaved invoice was restored from this browser. */
export function UnsavedDraftNotice({
  restoredAt,
  onDiscard,
  onDismiss,
}: {
  restoredAt: number;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.06] px-3.5 py-2.5 text-sm"
    >
      <History className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
      <p className="flex-1 font-medium text-foreground">
        Restored your unsaved invoice from {formatIstTime(new Date(restoredAt))}.
        <span className="text-muted-foreground"> It stays on this device until you save it.</span>
      </p>
      <button
        type="button"
        onClick={onDiscard}
        className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-bold text-rose-600 hover:bg-rose-500/10 cursor-pointer"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide this message"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
