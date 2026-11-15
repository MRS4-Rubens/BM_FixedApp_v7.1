'use client';

import { useState, Fragment } from 'react';
import {
  History,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Copy,
  Check,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { formatPaiseAsInr } from '@/lib/money';
import type { BizHistoryRow } from './types';

interface HistoricalClaimsSectionProps {
  bizHistory: BizHistoryRow[];
  bizHistoryPage: number;
  loadingHistory: boolean;
  businessName: string;
  copiedKey: string | null;
  onCopy?: (text: string, key: string) => void;
  onSetBizHistoryPage: (updater: (p: number) => number) => void;
  onViewProof?: (requestId: string, businessName: string, utr: string) => void;
}

export function HistoricalClaimsSection({
  bizHistory,
  bizHistoryPage,
  loadingHistory,
  businessName,
  copiedKey,
  onCopy,
  onSetBizHistoryPage,
  onViewProof,
}: HistoricalClaimsSectionProps) {
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  const toggleClaimExpansion = (claimId: string) => {
    setExpandedClaimId((prev) => (prev === claimId ? null : claimId));
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
        <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <History className="size-4 text-muted-foreground" /> Historical Subscription Claims
        </h4>
        <span className="text-xs font-semibold text-muted-foreground">
          {bizHistory.length} total recorded
        </span>
      </div>

      {loadingHistory ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-indigo-600" />
        </div>
      ) : bizHistory.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground font-semibold">
          No previous subscription claim records for this business.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border font-bold text-muted-foreground text-xs">
                  <th className="px-3 py-2.5 whitespace-nowrap">Plan Details</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Start Date</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Expiry Date</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Subscription Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {bizHistory
                  .slice((bizHistoryPage - 1) * 3, bizHistoryPage * 3)
                  .map((item) => {
                    const isExpanded = expandedClaimId === item.id;

                    return (
                      <Fragment key={item.id}>
                        <tr className={cn("group hover:bg-muted/10 transition", isExpanded && "bg-muted/15")}>
                          {/* 1. Plan Details */}
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-foreground capitalize">
                              {item.planName}
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                ({item.billingCycle.replace('_', ' ')})
                              </span>
                            </div>
                          </td>

                          {/* 2. Start Date */}
                          <td className="px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">
                            {item.approvedAt
                              ? formatIstDate(item.approvedAt)
                              : item.status === 'approved'
                                ? formatIstDate(item.createdAt)
                                : '—'}
                          </td>

                          {/* 3. Expiry Date */}
                          <td className="px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">
                            {item.subscriptionEndsAt ? (
                              formatIstDate(item.subscriptionEndsAt)
                            ) : (
                              <span title="Not recorded for this claim">—</span>
                            )}
                          </td>

                          {/* 4. Status Badge */}
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold capitalize",
                                item.status === 'approved' && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
                                item.status === 'pending' && "bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-500/20",
                                item.status === 'rejected' && "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                              )}
                            >
                              {item.status}
                            </span>
                          </td>

                          {/* 5. Subscription Details Button */}
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => toggleClaimExpansion(item.id)}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-bold transition cursor-pointer",
                                isExpanded
                                  ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
                                  : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                              <ChevronDown
                                className={cn(
                                  "size-3.5 transition-transform duration-200",
                                  isExpanded && "rotate-180"
                                )}
                              />
                            </button>
                          </td>
                        </tr>

                        {/* Inline Expandable Accordion Sub-row */}
                        {isExpanded && (
                          <tr className="bg-muted/20 border-b border-border/40">
                            <td colSpan={5} className="p-3">
                              <div className="rounded-xl border border-indigo-500/30 bg-background p-3.5 space-y-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                                  <span className="text-xs font-bold text-foreground font-heading uppercase tracking-wider flex items-center gap-1.5">
                                    <span>Claim Transaction Details</span>
                                    <span className="text-muted-foreground font-mono text-[11px] font-normal">
                                      ({item.id.slice(0, 8)}...)
                                    </span>
                                  </span>
                                  <span className="text-xs font-bold text-foreground font-heading">
                                    <span className="text-muted-foreground font-semibold font-sans">Amount Paid: </span>
                                    <span>{formatPaiseAsInr(item.amountPaise)}</span>
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1.25fr] divide-y sm:divide-y-0 sm:divide-x divide-border/40 text-xs py-1 gap-2 sm:gap-0">
                                  {/* 1. Claim Date */}
                                  <div className="sm:pr-4 space-y-1 shrink-0">
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block whitespace-nowrap">
                                      Claim Date
                                    </span>
                                    <div className="font-semibold text-foreground text-xs sm:text-sm sm:whitespace-nowrap">
                                      {formatIstDate(item.createdAt)}
                                    </div>
                                  </div>

                                  {/* 2. Payment Reference / UTR */}
                                  <div className="sm:px-4 space-y-1 min-w-0">
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block whitespace-nowrap">
                                      Payment Reference / UTR
                                    </span>
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-xs sm:text-sm tracking-wider sm:whitespace-nowrap break-all sm:break-normal">
                                        {item.paymentReference}
                                      </span>
                                      {onCopy && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onCopy(item.paymentReference, `utr-${item.id}`)
                                          }
                                          className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer p-0.5 shrink-0"
                                          title="Copy UTR Reference"
                                        >
                                          {copiedKey === `utr-${item.id}` ? (
                                            <Check className="size-3.5 text-emerald-600" />
                                          ) : (
                                            <Copy className="size-3.5" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* 3. Payment Method & Target Payee */}
                                  <div className="sm:pl-4 space-y-1 min-w-0">
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block whitespace-nowrap">
                                      Payment Method &amp; Target Payee
                                    </span>
                                    <div className="font-semibold text-foreground text-xs leading-snug">
                                      {item.paymentMethod === 'manual_override' ? (
                                        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                          <span className="rounded bg-slate-500/10 px-1.5 py-0.5 text-slate-700 dark:text-slate-300 font-bold text-[11px] shrink-0">
                                            Manual
                                          </span>
                                          <span className="text-xs text-muted-foreground sm:whitespace-nowrap break-all sm:break-normal">
                                            Admin override (no payment)
                                          </span>
                                        </div>
                                      ) : item.paymentMethod === 'upi_qr' || item.paymentMethod === 'upi_id' ? (
                                        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                          <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-indigo-600 dark:text-indigo-400 font-bold text-[11px] shrink-0">
                                            UPI
                                          </span>
                                          <span className="font-mono text-xs sm:whitespace-nowrap break-all sm:break-normal">
                                            {item.paidToVpa
                                              ? `Paid to: ${item.paidToVpa}`
                                              : 'Payee not recorded'}
                                          </span>
                                        </div>
                                      ) : item.paymentMethod === 'bank_transfer' ? (
                                        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400 font-bold text-[11px] shrink-0">
                                            Bank
                                          </span>
                                          <span className="font-mono text-xs sm:whitespace-nowrap break-all sm:break-normal">
                                            {item.paidToAccount
                                              ? `A/C: ${item.paidToAccount} (${item.paidToIfsc ?? ''})`
                                              : 'Payee not recorded'}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-muted-foreground sm:whitespace-nowrap break-all sm:break-normal">
                                          {item.paymentMethod}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Note box */}
                                {item.rejectReason && (
                                  <div
                                    className={cn(
                                      "rounded-lg border p-2.5 text-xs font-semibold leading-relaxed",
                                      item.status === 'rejected'
                                        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                                        : item.paymentMethod === 'manual_override'
                                          ? "border-border/60 bg-muted/40 text-muted-foreground"
                                          : "border-border/60 bg-muted/20 text-foreground"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "font-bold uppercase tracking-wider text-[11px] mr-1.5",
                                        item.status === 'rejected'
                                          ? "text-rose-800 dark:text-rose-300"
                                          : item.paymentMethod === 'manual_override'
                                            ? "text-muted-foreground"
                                            : "text-foreground"
                                      )}
                                    >
                                      {item.status === 'rejected'
                                        ? 'Admin Rejection Note:'
                                        : item.paymentMethod === 'manual_override'
                                          ? 'Override Note:'
                                          : 'Note:'}
                                    </span>
                                    <span>{item.rejectReason}</span>
                                  </div>
                                )}

                                {/* Screenshot Action */}
                                {item.hasScreenshot && onViewProof && (
                                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      Customer attached a payment screenshot for this transaction.
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        onViewProof(
                                          item.id,
                                          businessName,
                                          item.paymentReference
                                        )
                                      }
                                      className="h-7 text-xs font-bold gap-1.5 cursor-pointer border-indigo-300 hover:bg-indigo-50 text-indigo-700 dark:text-indigo-400"
                                    >
                                      <Eye className="size-3.5" />
                                      View Payment Screenshot
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls for Claims */}
          {bizHistory.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-0.5 px-0.5 text-xs">
              <span className="text-muted-foreground font-medium">
                Showing {(bizHistoryPage - 1) * 3 + 1} to{' '}
                {Math.min(bizHistoryPage * 3, bizHistory.length)} of {bizHistory.length} claims
              </span>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-muted-foreground mr-1.5">
                  Page {bizHistoryPage} of {Math.max(1, Math.ceil(bizHistory.length / 3))}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetBizHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={bizHistoryPage === 1}
                  className="h-6.5 px-2 text-xs font-semibold cursor-pointer border-border disabled:opacity-40"
                >
                  <ChevronLeft className="size-3 mr-0.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onSetBizHistoryPage((p) =>
                      Math.min(Math.max(1, Math.ceil(bizHistory.length / 3)), p + 1)
                    )
                  }
                  disabled={bizHistoryPage >= Math.max(1, Math.ceil(bizHistory.length / 3))}
                  className="h-6.5 px-2 text-xs font-semibold cursor-pointer border-border disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="size-3 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
