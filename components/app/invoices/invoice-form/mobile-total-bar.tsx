'use client';

import { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { formatINR } from './form-calculations';

/** id of the element that holds the totals and the Save / Finalize buttons. */
export const INVOICE_SUMMARY_ID = 'invoice-summary';

/**
 * Phones only (mobile plan step 3): a slim bar pinned to the bottom of the form while items are being entered, with
 * the live grand total and a button that scrolls to the summary (Save draft / Finalize). It hides itself once the
 * summary card is on screen, so it never duplicates the real buttons. `-bottom-6` cancels the page's 24px bottom
 * padding on phones, so the bar sits flush on the tab bar.
 */
export function MobileTotalBar({ grandTotal }: { grandTotal: number }) {
  const [summaryVisible, setSummaryVisible] = useState(false);

  useEffect(() => {
    const summary = document.getElementById(INVOICE_SUMMARY_ID);
    if (!summary || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setSummaryVisible(Boolean(entry?.isIntersecting)), {
      threshold: 0.15,
    });
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);

  if (summaryVisible) return null;

  return (
    <div className="sticky -bottom-6 z-20 -mx-3 border-t border-border/70 bg-card/95 px-3 py-2 backdrop-blur-md shadow-[0_-6px_16px_-10px_rgba(79,70,229,0.18)] md:hidden print:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Grand total</p>
          <p className="text-lg font-black text-primary font-heading tabular-nums [overflow-wrap:anywhere]">{formatINR(grandTotal)}</p>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById(INVOICE_SUMMARY_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Review &amp; save
          <ArrowDown className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
