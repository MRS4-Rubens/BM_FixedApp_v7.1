'use client';

import { useFormContext } from 'react-hook-form';
import { Receipt, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { StateTaxLabel } from '@/lib/gst/indian-states';
import { formatINR } from './form-calculations';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';

const sectionTitleCls = "flex items-center gap-2 mb-2 pb-1.5 border-b border-border";

export function TotalsSummaryCard({
  supplyType,
  totalTaxable,
  totalCGST,
  totalSGST,
  totalIGST,
  roundOff,
  grandTotal,
  isFinalizing,
  isSavingDraft = false,
  onSaveDraft,
  onFinalizeClick,
  taxLabel = 'SGST',
}: {
  supplyType: 'intra_state' | 'inter_state';
  totalTaxable: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  roundOff: number;
  grandTotal: number;
  isFinalizing: boolean;
  /** BUG-06: a draft save is running or its page is loading; both buttons stay disabled (no second draft). */
  isSavingDraft?: boolean;
  onSaveDraft: (data: InvoiceDraftInput) => void;
  onFinalizeClick: (data: InvoiceDraftInput) => void;
  taxLabel?: StateTaxLabel;
}) {
  const { handleSubmit, formState: { isSubmitting } } = useFormContext<InvoiceDraftInput>();

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm flex flex-col h-full">
      <div className={sectionTitleCls}>
        <Receipt className="size-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground uppercase tracking-wider whitespace-nowrap">Summary &amp; GST Breakdown</span>
      </div>
      <div className="mb-1">
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border whitespace-nowrap', supplyType === 'intra_state' ? 'bg-success-subtle text-success-text border-success/20' : 'bg-blue-100/60 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-900')}>
          {supplyType === 'intra_state' ? `Intra-state Supply (CGST + ${taxLabel})` : 'Inter-state Supply (IGST)'}
        </span>
      </div>
      <div className="flex flex-col flex-1 justify-between mt-1">
        <div className="divide-y divide-zinc-150 dark:divide-zinc-800/40 text-sm border-b border-zinc-150 dark:border-zinc-800/40 mb-2.5">
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground font-semibold whitespace-nowrap">Taxable Value</span>
            <span className="font-bold text-foreground whitespace-nowrap">{formatINR(totalTaxable)}</span>
          </div>
          {supplyType === 'intra_state' ? (
            <>
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground font-semibold flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] shrink-0" />
                  CGST
                </span>
                <span className="font-bold text-foreground whitespace-nowrap">{formatINR(totalCGST)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground font-semibold flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] shrink-0" />
                  {taxLabel}
                </span>
                <span className="font-bold text-foreground whitespace-nowrap">{formatINR(totalSGST)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground font-semibold flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)] shrink-0" />
                IGST
              </span>
              <span className="font-bold text-foreground whitespace-nowrap">{formatINR(totalIGST)}</span>
            </div>
          )}

          {/* Rounded Off Row */}
          <div className="flex justify-between py-0.5 italic text-muted-foreground">
            <span className="font-semibold whitespace-nowrap">Rounded Off</span>
            <span className="font-bold whitespace-nowrap">
              {roundOff >= 0 ? `+₹${roundOff.toFixed(2)}` : `-₹${Math.abs(roundOff).toFixed(2)}`}
            </span>
          </div>
        </div>

        <div>
          <div className="rounded-xl bg-gradient-to-r from-primary/[0.05] to-primary/[0.015] dark:from-primary/[0.04] dark:to-transparent border-2 border-primary/30 dark:border-primary/20 px-3.5 py-2 flex justify-between items-center shadow-[0_0_20px_rgba(59,130,246,0.14),inset_0_1px_0_rgba(255,255,255,0.05)] dark:shadow-[0_0_25px_rgba(59,130,246,0.09),inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-primary/50 hover:shadow-[0_0_28px_rgba(59,130,246,0.22),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300">
            <span className="text-base font-bold text-foreground whitespace-nowrap">Grand Total</span>
            <span className="text-xl font-black text-primary font-heading whitespace-nowrap">{formatINR(grandTotal)}</span>
          </div>

          <div className="mt-2.5 flex gap-2.5">
            <Button variant="outline" size="sm" type="button" className="flex-1 shadow-sm font-bold text-sm whitespace-nowrap" disabled={isSubmitting || isFinalizing || isSavingDraft} onClick={handleSubmit(onSaveDraft)}>
              {isSavingDraft ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button type="button" size="sm" className="btn-shine-navy flex-1 shadow-sm font-bold text-sm hover:glow-btn whitespace-nowrap" disabled={isSubmitting || isFinalizing || isSavingDraft} onClick={handleSubmit(onFinalizeClick)}>
              <Send className="size-4 shrink-0" /> <span className="whitespace-nowrap">{isFinalizing ? 'Finalizing...' : 'Finalize Invoice'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

