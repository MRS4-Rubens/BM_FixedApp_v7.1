'use client';

import Link from 'next/link';
import {
  Layers,
  Search,
  RefreshCw,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertCircle,
  Receipt,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { formatPaiseAsInr } from '@/lib/money';
import { ITEMS_PER_PAGE, type StatusFilter } from './plan-configs';
import type { SubscriptionHistoryItem } from './types';

interface ClaimsLedgerProps {
  searchQuery: string;
  statusFilter: StatusFilter;
  isRefreshing: boolean;
  filteredSubscriptions: SubscriptionHistoryItem[];
  paginatedSubscriptions: SubscriptionHistoryItem[];
  historyPage: number;
  totalHistoryPages: number;
  copiedUtr: string | null;
  onCopy: (text: string) => void;
  onSearchChange: (query: string) => void;
  onStatusFilterChange: (filter: string) => void;
  onRefresh: () => void;
  onSetHistoryPage: (page: number | ((p: number) => number)) => void;
  onSelectReceipt: (receipt: SubscriptionHistoryItem) => void;
}

export function ClaimsLedger({
  searchQuery,
  statusFilter,
  isRefreshing,
  filteredSubscriptions,
  paginatedSubscriptions,
  historyPage,
  totalHistoryPages,
  copiedUtr,
  onCopy,
  onSearchChange,
  onStatusFilterChange,
  onRefresh,
  onSetHistoryPage,
  onSelectReceipt,
}: ClaimsLedgerProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-3.5">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Layers className="size-4 text-indigo-500" />
            Payment & Subscription History
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Historical ledger of all manual UPI / NEFT payment claims submitted by your business.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search UTR / Plan..."
              className="h-8 w-44 sm:w-52 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-700 outline-none cursor-pointer focus:border-indigo-500 focus:bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-sm font-semibold cursor-pointer border-slate-200 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={cn('size-4 shrink-0', isRefreshing && 'animate-spin')} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {filteredSubscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <CreditCard className="size-9 text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-800">No subscription records found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            {searchQuery || statusFilter !== 'all'
              ? 'No transactions matched your search or status filter. Try clearing filters.'
              : "You haven't submitted any manual payment claims yet. When you upgrade via UPI or bank transfer, your transaction will appear here."}
          </p>
          <Link href="/checkout" className="mt-4">
            <Button size="sm" className="h-8 text-sm font-bold cursor-pointer">
              Upgrade Account Now
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-600">
                  <th className="px-3.5 py-2">Date</th>
                  <th className="px-3.5 py-2">Plan & Cycle</th>
                  <th className="px-3.5 py-2">Amount</th>
                  <th className="px-3.5 py-2">Payment Mode</th>
                  <th className="px-3.5 py-2">UTR / Reference</th>
                  <th className="px-3.5 py-2">Status</th>
                  <th className="px-3.5 py-2 text-right">Voucher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedSubscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-3.5 py-2 whitespace-nowrap font-medium text-slate-800">
                      {formatIstDate(sub.createdAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap capitalize font-bold text-slate-900">
                      {sub.planName}{' '}
                      <span className="text-xs text-slate-400 font-normal">
                        ({sub.billingCycle})
                      </span>
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap font-extrabold text-slate-900 font-heading">
                      {formatPaiseAsInr(sub.amountPaise)}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap text-slate-500 capitalize">
                      {sub.paymentMethod === 'upi_qr'
                        ? 'UPI QR'
                        : sub.paymentMethod === 'upi_id'
                        ? 'UPI ID'
                        : sub.paymentMethod === 'manual_override'
                        ? 'System Override'
                        : 'Bank Transfer'}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-800 font-semibold">{sub.paymentReference}</span>
                        <button
                          type="button"
                          onClick={() => onCopy(sub.paymentReference)}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                          title="Copy reference"
                        >
                          {copiedUtr === sub.paymentReference ? (
                            <Check className="size-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap">
                      {sub.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-bold text-emerald-700 shadow-2xs">
                          <CheckCircle2 className="size-3.5" />
                          Approved
                        </span>
                      ) : sub.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 text-xs font-bold text-amber-800 shadow-2xs">
                          <Clock className="size-3.5 animate-pulse" />
                          Verification Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200/80 px-2.5 py-0.5 text-xs font-bold text-rose-700 shadow-2xs">
                          <AlertCircle className="size-3.5" />
                          Rejected
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelectReceipt(sub)}
                        className="h-7 px-2.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                      >
                        <Receipt className="size-3.5 mr-1" />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {filteredSubscriptions.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-1 px-1">
              <span className="text-xs text-slate-500 font-medium">
                Showing <strong className="text-slate-700">{(historyPage - 1) * ITEMS_PER_PAGE + 1}</strong> to{' '}
                <strong className="text-slate-700">
                  {Math.min(historyPage * ITEMS_PER_PAGE, filteredSubscriptions.length)}
                </strong>{' '}
                of <strong className="text-slate-700">{filteredSubscriptions.length}</strong> transactions
              </span>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 mr-2">
                  Page {historyPage} of {totalHistoryPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={historyPage === 1}
                  className="h-7 px-2.5 text-xs font-semibold cursor-pointer border-slate-200 disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5 mr-0.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                  disabled={historyPage >= totalHistoryPages}
                  className="h-7 px-2.5 text-xs font-semibold cursor-pointer border-slate-200 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="size-3.5 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

