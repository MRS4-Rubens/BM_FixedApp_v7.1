'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One header for every modal: tinted bar, icon chip, title (+ optional one-line description) and the × on the right.
 * It stays pinned at the top while the modal body scrolls (important on phones, where the × must never scroll away).
 *
 * Colour groups (one per kind of action, so the colour tells the user what kind of step this is):
 * - danger   rose     void / delete / remove / reject / close account
 * - document indigo   finalize / send / preview / invoice-number format
 * - money    emerald  receipts, approving payments, subscriptions, payee settings
 * - premium  violet   upgrade prompts and plan-locked features
 * - caution  amber    allowed but needs care (back-dated invoice, GSTIN correction, role change)
 * - tools    teal     import, signature upload, reactivate, proof viewer
 */
export type ModalTone = 'danger' | 'document' | 'money' | 'premium' | 'caution' | 'tools';

const TONES: Record<ModalTone, { bar: string; chip: string }> = {
  danger: {
    bar: 'bg-rose-50 border-rose-200/70 dark:bg-rose-500/10 dark:border-rose-500/20',
    chip: 'bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/25',
  },
  document: {
    bar: 'bg-indigo-50 border-indigo-200/70 dark:bg-indigo-500/10 dark:border-indigo-500/20',
    chip: 'bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/25',
  },
  money: {
    bar: 'bg-emerald-50 border-emerald-200/70 dark:bg-emerald-500/10 dark:border-emerald-500/20',
    chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25',
  },
  premium: {
    bar: 'bg-gradient-to-r from-violet-50 via-indigo-50 to-amber-50 border-violet-200/70 dark:from-violet-500/10 dark:via-indigo-500/10 dark:to-amber-500/10 dark:border-violet-500/20',
    chip: 'bg-gradient-to-br from-violet-600 to-indigo-600 text-amber-200 ring-violet-300 dark:ring-violet-500/40',
  },
  caution: {
    bar: 'bg-amber-50 border-amber-200/70 dark:bg-amber-500/10 dark:border-amber-500/20',
    chip: 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
  },
  tools: {
    bar: 'bg-teal-50 border-teal-200/70 dark:bg-teal-500/10 dark:border-teal-500/20',
    chip: 'bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/25',
  },
};

const closeCls =
  'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-white/90 text-muted-foreground shadow-xs transition-colors hover:bg-white hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer dark:bg-card dark:hover:bg-accent';

export interface ModalHeaderProps {
  tone: ModalTone;
  icon: LucideIcon;
  title: ReactNode;
  /** One short line under the title. Longer explanations belong in the body. */
  description?: ReactNode;
  /** Accessible name of the ×, e.g. "Close void payment". Defaults to "Close". */
  closeLabel?: string;
  closeDisabled?: boolean;
  /**
   * 'dialog' (default): inside a Base UI Dialog / AlertDialog; wires Dialog.Title / Description / Close.
   * 'plain': a hand-built modal; pass titleId (for aria-labelledby) and onClose.
   */
  mode?: 'dialog' | 'plain';
  titleId?: string;
  onClose?: () => void;
  /** Extra controls between the title and the × (e.g. a template picker). Give them order/basis classes to wrap. */
  actions?: ReactNode;
  className?: string;
}

export function ModalHeader({
  tone,
  icon: Icon,
  title,
  description,
  closeLabel = 'Close',
  closeDisabled,
  mode = 'dialog',
  titleId,
  onClose,
  actions,
  className,
}: ModalHeaderProps) {
  const t = TONES[tone];
  const titleCls = 'text-[15px] sm:text-base font-bold text-foreground tracking-tight leading-snug';
  const descCls = 'mt-0.5 text-xs text-muted-foreground leading-snug';

  const closeButton = (
    <button
      type="button"
      data-modal-header-close
      aria-label={closeLabel}
      disabled={closeDisabled}
      onClick={mode === 'plain' ? onClose : undefined}
      className={closeCls}
    >
      <X className="size-4 text-red-500 dark:text-red-400" />
    </button>
  );

  return (
    <div
      data-modal-header
      className={cn('sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5', t.bar, className)}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 shadow-xs', t.chip)}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {mode === 'dialog' ? (
          <>
            <Dialog.Title render={<h2 className={titleCls} />}>{title}</Dialog.Title>
            {description && <Dialog.Description render={<p className={descCls} />}>{description}</Dialog.Description>}
          </>
        ) : (
          <>
            <h2 id={titleId} className={titleCls}>
              {title}
            </h2>
            {description && <p className={descCls}>{description}</p>}
          </>
        )}
      </div>
      {actions}
      {mode === 'dialog' ? <Dialog.Close render={closeButton} disabled={closeDisabled} /> : closeButton}
    </div>
  );
}
