'use client';

import { useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Popover } from '@base-ui/react/popover';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  INVOICE_TAGLINE_MAX,
  INVOICE_TAGLINE_EXAMPLES,
  normaliseInvoiceTagline,
} from '@/lib/business/invoice-tagline';

const baseInputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 h-9 text-sm text-slate-900 font-medium placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:ring-2 shadow-2xs transition-all';
const inputGreenClass = `${baseInputClass} focus:ring-emerald-800/15 focus:border-emerald-800`;
const errorClass = 'mt-1 text-xs font-semibold text-destructive';

export interface InvoiceTaglineFieldProps {
  idPrefix: string;
  registration: UseFormRegisterReturn<'invoice_tagline'>;
  value: string | undefined;
  error?: string;
  onUseExample: (text: string) => void;
  className?: string;
}

export function InvoiceTaglineField({
  idPrefix,
  registration,
  value,
  error,
  onUseExample,
  className,
}: InvoiceTaglineFieldProps) {
  const [open, setOpen] = useState(false);
  const inputId = `${idPrefix}-invoice-tagline`;
  const len = normaliseInvoiceTagline(value)?.length ?? 0;

  return (
    <div className={cn('w-full min-w-0', className)}>
      {/* Label Row */}
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Sparkles className="size-3.5 text-emerald-800 shrink-0" />
          <span>Invoice Tagline (Optional)</span>
        </label>

        {/* Base UI Popover for 'See examples' */}
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            type="button"
            className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 hover:underline cursor-pointer inline-flex items-center gap-1"
          >
            See examples
          </Popover.Trigger>
          <Popover.Portal>
            {/* z-index on the Positioner (the fixed layer), so the list sits above the sticky app header */}
            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[70]">
              <Popover.Popup className="w-[min(340px,calc(100vw-2rem))] sm:w-[420px] rounded-xl bg-white p-3.5 shadow-xl border border-slate-200 text-slate-900 focus:outline-none animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                  <p className="text-xs font-medium text-slate-600">
                    Tap Use to fill the field, then edit it to match your shop.
                  </p>
                  <Popover.Close
                    type="button"
                    className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    aria-label="Close examples"
                  >
                    <X className="size-3.5 text-red-500 dark:text-red-400" />
                  </Popover.Close>
                </div>
                <div className="mt-2.5 space-y-2 max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {INVOICE_TAGLINE_EXAMPLES.map((example, idx) => (
                    <div key={idx} className="pt-2 first:pt-0 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-800 leading-snug">{example}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onUseExample(example);
                          setOpen(false);
                        }}
                        className="shrink-0 px-2.5 py-1 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition cursor-pointer"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {/* Input */}
      <input
        id={inputId}
        type="text"
        maxLength={INVOICE_TAGLINE_MAX}
        placeholder="e.g. WHOLESALERS & RETAILERS OF TEXT BOOKS, NOTE BOOKS & STATIONERY"
        className={cn(
          inputGreenClass,
          'uppercase',
          error && 'border-destructive focus:ring-destructive/20'
        )}
        {...registration}
      />

      {/* Helper text and counter row */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-xs text-muted-foreground">
          Printed under your business name on Templates 2, 3 and 4. Changes apply to new invoices only.
        </p>
        <span
          className={cn(
            'text-xs font-medium tabular-nums shrink-0',
            len > INVOICE_TAGLINE_MAX ? 'text-destructive font-bold' : 'text-muted-foreground'
          )}
        >
          {len} / {INVOICE_TAGLINE_MAX}
        </span>
      </div>

      {/* Field error below */}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

