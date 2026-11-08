'use client';

import { Percent } from 'lucide-react';
import { formatINR, type GstRateRow } from './form-calculations';

const sectionTitleCls = "flex items-center gap-2 mb-2 pb-1.5 border-b border-border";

export function GstBreakdownCard({
  sortedGstRates,
  gstBreakdownMap,
  totalTaxable,
  taxResult,
}: {
  sortedGstRates: number[];
  gstBreakdownMap: Record<number, GstRateRow>;
  totalTaxable: number;
  taxResult: { totalCgstPaise: number; totalSgstPaise: number; totalIgstPaise: number } | null;
}) {
  const formatTaxBreakdown = (paise: number) => {
    if (paise === 0) {
      return <span className="text-zinc-300 dark:text-zinc-700 font-normal select-none">–</span>;
    }
    return formatINR(paise / 100);
  };

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm flex flex-col h-full">
      <div className={sectionTitleCls}>
        <Percent className="size-4 text-primary" />
        <span className="text-sm font-bold text-foreground uppercase tracking-wider">GST Rate-wise Breakdown</span>
      </div>
      <div className="overflow-x-auto flex-1 mt-1">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <th className="px-3 py-1 text-left font-bold text-muted-foreground uppercase tracking-wider text-xs">GST Rate</th>
              <th className="px-3 py-1 text-right font-bold text-muted-foreground uppercase tracking-wider text-xs">Taxable Value</th>
              <th className="px-3 py-1 text-right font-bold text-muted-foreground uppercase tracking-wider text-xs">CGST</th>
              <th className="px-3 py-1 text-right font-bold text-muted-foreground uppercase tracking-wider text-xs">SGST</th>
              <th className="px-3 py-1 text-right font-bold text-muted-foreground uppercase tracking-wider text-xs">IGST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {sortedGstRates.map(rate => {
              const row = gstBreakdownMap[rate];
              return (
                <tr key={rate} className="hover:bg-muted/5 transition-colors">
                  <td className="px-3 py-1 text-left font-semibold text-foreground">{rate}%</td>
                  <td className="px-3 py-1 text-right text-foreground">{formatINR(row.taxableValuePaise / 100)}</td>
                  <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(row.cgstPaise)}</td>
                  <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(row.sgstPaise)}</td>
                  <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(row.igstPaise)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold bg-muted/5">
              <td className="px-3 py-1 text-left text-foreground">Total</td>
              <td className="px-3 py-1 text-right text-foreground">{formatINR(totalTaxable)}</td>
              <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(taxResult ? taxResult.totalCgstPaise : 0)}</td>
              <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(taxResult ? taxResult.totalSgstPaise : 0)}</td>
              <td className="px-3 py-1 text-right text-foreground">{formatTaxBreakdown(taxResult ? taxResult.totalIgstPaise : 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

