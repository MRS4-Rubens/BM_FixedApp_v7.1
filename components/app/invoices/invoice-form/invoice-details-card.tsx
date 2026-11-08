'use client';

import { useFormContext } from 'react-hook-form';
import { Calendar, ClipboardEdit, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-all hover:border-muted-foreground/30 shadow-sm";
const labelCls = "mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap";
const sectionTitleCls = "flex items-center gap-2 mb-2 pb-1.5 border-b border-border";

export function InvoiceDetailsCard({
  invoiceNumberFormatPreview,
  showPreviewWarning,
  setIsPreviewOpen,
  setShowPreviewWarning,
}: {
  invoiceNumberFormatPreview: string;
  showPreviewWarning: boolean;
  setIsPreviewOpen: (open: boolean) => void;
  setShowPreviewWarning: (show: boolean) => void;
}) {
  const { register, formState: { errors } } = useFormContext<InvoiceDraftInput>();

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm lg:col-span-7">
      <div className={sectionTitleCls}>
        <ClipboardEdit className="size-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground uppercase tracking-wider whitespace-nowrap">Invoice Info</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <div>
          <label htmlFor="invoice-number-input" className={labelCls}>Invoice Number</label>
          <div className="relative">
            <input
              id="invoice-number-input"
              aria-label="Invoice number (assigned on finalize)"
              type="text"
              readOnly
              value={invoiceNumberFormatPreview}
              className={cn(inputCls, 'pr-16 font-mono text-xs text-muted-foreground bg-muted/50 border-dashed')}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-bold text-success-text border border-success/20 whitespace-nowrap">AUTO</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground whitespace-nowrap truncate">Will lock to a formal series on finalize</p>
        </div>
        <div>
          <label htmlFor="invoice-date-input" className={labelCls}>Invoice Date</label>
          <div className="relative">
            <input
              id="invoice-date-input"
              aria-label="Invoice date"
              type="date"
              className={cn(inputCls, 'pr-10', errors.invoice_date && 'border-destructive focus:ring-destructive/30 animate-shake')}
              {...register('invoice_date')}
            />
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none size-4 text-muted-foreground" />
          </div>
          {errors.invoice_date ? (
            <p className="mt-1 text-xs text-destructive font-medium">{errors.invoice_date.message}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground whitespace-nowrap truncate">Select the legal date of this invoice</p>
          )}
        </div>
        <div>
          <label className={labelCls}>Print Preview</label>
          <button
            id="draft-preview-btn"
            type="button"
            onClick={() => {
              setIsPreviewOpen(true);
              setShowPreviewWarning(false);
            }}
            className={cn(
              "flex w-full items-center justify-center gap-2 px-3 py-1.5 border rounded-lg text-sm font-semibold transition-all h-[34px] shadow-sm whitespace-nowrap",
              showPreviewWarning
                ? "border-destructive text-destructive bg-destructive/10 ring-2 ring-destructive/20 animate-shake"
                : "border-input bg-background hover:bg-accent text-foreground hover:text-accent-foreground"
            )}
          >
            <Eye className="size-4 shrink-0" /> <span>Preview Invoice</span>
          </button>
          <p className="mt-1 text-xs text-muted-foreground whitespace-nowrap truncate">Verification check required</p>
        </div>
      </div>
    </div>
  );
}

