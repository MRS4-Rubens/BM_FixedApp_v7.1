'use client';

import { Download, Search, X, ArrowUpDown, Check, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { getVisiblePageNumbers, ROWS_PER_PAGE } from './pagination';
import type { BusinessItem } from './types';

interface BusinessesTabProps {
  totalBusinessesCount: number;
  filteredBusinesses: BusinessItem[];
  paginatedBusinesses: BusinessItem[];
  bizSearch: string;
  bizStatusFilter: 'all' | 'active' | 'trial' | 'expired' | 'suspended';
  totalBizPages: number;
  safeBizPage: number;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onChangeBizSearch: (value: string) => void;
  onChangeBizStatusFilter: (status: 'all' | 'active' | 'trial' | 'expired' | 'suspended') => void;
  onToggleBizSort: (field: 'name' | 'expiry' | 'invoices') => void;
  onSetBizPage: (page: number | ((p: number) => number)) => void;
  onExportCsv: () => void;
  onOpenManageBiz: (biz: BusinessItem) => void;
}

export function BusinessesTab({
  totalBusinessesCount,
  filteredBusinesses,
  paginatedBusinesses,
  bizSearch,
  bizStatusFilter,
  totalBizPages,
  safeBizPage,
  copiedKey,
  onCopy,
  onChangeBizSearch,
  onChangeBizStatusFilter,
  onToggleBizSort,
  onSetBizPage,
  onExportCsv,
  onOpenManageBiz,
}: BusinessesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground font-heading">
            Client Businesses Directory ({filteredBusinesses.length} of {totalBusinessesCount})
          </h3>
          <p className="text-xs font-semibold text-muted-foreground">
            Search, inspect invoices, and manage subscription lifecycles.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onExportCsv}
          className="h-8.5 gap-1.5 text-sm font-semibold self-start sm:self-auto"
        >
          <Download className="size-4 text-indigo-600" /> Export CSV
        </Button>
      </div>

      {/* Search and filter toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card p-3 rounded-xl border border-border shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by legal name, trade name, GSTIN, or email..."
            value={bizSearch}
            onChange={(e) => onChangeBizSearch(e.target.value)}
            className="h-9.5 w-full rounded-lg border border-border bg-background pl-9.5 pr-8 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          {bizSearch && (
            <button
              type="button"
              onClick={() => onChangeBizSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4 text-red-500 dark:text-red-400" />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {(['all', 'active', 'trial', 'expired', 'suspended'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => onChangeBizStatusFilter(st)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-sm font-bold capitalize transition cursor-pointer',
                bizStatusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full table-auto text-left text-sm border-collapse [&_th]:align-middle [&_td]:align-middle">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <th scope="col" className="w-full min-w-[22rem] px-4 py-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onToggleBizSort('name')}
                    className="flex items-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    Business & GSTIN
                    <ArrowUpDown className="size-3.5 shrink-0" />
                  </button>
                </th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Plan & Status</th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onToggleBizSort('expiry')}
                    className="flex w-full items-center justify-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    Expires At
                    <ArrowUpDown className="size-3.5 shrink-0" />
                  </button>
                </th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onToggleBizSort('invoices')}
                    className="flex w-full items-center justify-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    Invoices
                    <ArrowUpDown className="size-3.5 shrink-0" />
                  </button>
                </th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Staff</th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium">
              {filteredBusinesses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground font-semibold text-sm">
                    No businesses found matching current filters.
                  </td>
                </tr>
              ) : (
                paginatedBusinesses.map((biz) => {
                  const isPaying = biz.subscriptionStatus === 'active';
                  const isSuspended = biz.subscriptionStatus === 'suspended';
                  const isTrial = biz.subscriptionStatus === 'trial';
                  const isExpired = biz.subscriptionStatus === 'expired';

                  return (
                    <tr key={biz.id} className="hover:bg-muted/15 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex min-w-[20rem] flex-col">
                          <span className="font-bold text-foreground text-sm [overflow-wrap:anywhere]">{biz.legalName}</span>
                          <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap text-xs text-muted-foreground font-medium">
                            <span>GSTIN No.:</span>
                            <span className="font-mono">{biz.gstin}</span>
                            <button
                              type="button"
                              onClick={() => onCopy(biz.gstin, `gstin-${biz.id}`)}
                              className="shrink-0 hover:text-indigo-600 transition cursor-pointer"
                              title="Copy GSTIN"
                            >
                              {copiedKey === `gstin-${biz.id}` ? (
                                <Check className="size-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-bold text-foreground capitalize text-xs">
                            {biz.subscriptionPlan}
                          </span>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
                              isPaying && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                              isTrial && 'bg-amber-50 text-amber-700 border-amber-200',
                              isSuspended && 'bg-rose-50 text-rose-700 border-rose-200',
                              isExpired && 'bg-zinc-100 text-zinc-700 border-zinc-200'
                            )}
                          >
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                isPaying && 'bg-emerald-500',
                                isTrial && 'bg-amber-500',
                                isSuspended && 'bg-rose-500',
                                isExpired && 'bg-zinc-400'
                              )}
                            />
                            {biz.subscriptionStatus}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap text-xs font-semibold">
                        {biz.subscriptionEndsAt ? (
                          <span>{formatIstDate(biz.subscriptionEndsAt)}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Lifetime / Unset</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap font-mono tabular-nums font-bold text-foreground text-sm">
                        <span className="inline-block min-w-[10ch]">{biz.invoiceCount}</span>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap tabular-nums font-semibold text-foreground text-sm">
                        <span className="inline-block min-w-[3ch]">{biz.userCount}</span>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenManageBiz(biz)}
                          className="h-7.5 px-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50 border-indigo-200"
                        >
                          Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Businesses Pagination Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-border/60 bg-muted/20 text-xs font-semibold text-muted-foreground">
          <div>
            {filteredBusinesses.length === 0 ? (
              <span>No businesses found</span>
            ) : (
              <span>
                Showing <strong className="text-foreground font-bold">{(safeBizPage - 1) * ROWS_PER_PAGE + 1}</strong>–
                <strong className="text-foreground font-bold">{Math.min(safeBizPage * ROWS_PER_PAGE, filteredBusinesses.length)}</strong> of{' '}
                <strong className="text-foreground font-bold">{filteredBusinesses.length}</strong> {filteredBusinesses.length === 1 ? 'business' : 'businesses'}
              </span>
            )}
          </div>

          {totalBizPages > 1 && (
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                disabled={safeBizPage <= 1}
                onClick={() => onSetBizPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted font-bold text-foreground text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                <ChevronLeft className="size-3.5" /> Previous
              </button>

              {getVisiblePageNumbers(safeBizPage, totalBizPages).map((pNum, idx) => {
                if (pNum === '...') {
                  return (
                    <span key={`biz-ellipsis-${idx}`} className="px-1.5 py-1 text-muted-foreground select-none">
                      ...
                    </span>
                  );
                }
                const num = pNum as number;
                const isActive = safeBizPage === num;
                return (
                  <button
                    key={`biz-page-${num}`}
                    type="button"
                    onClick={() => onSetBizPage(num)}
                    className={cn(
                      'min-w-[28px] h-7 px-2 rounded-lg font-bold text-xs transition cursor-pointer',
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'border border-border bg-background hover:bg-muted text-foreground'
                    )}
                  >
                    {num}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={safeBizPage >= totalBizPages}
                onClick={() => onSetBizPage((p) => Math.min(totalBizPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted font-bold text-foreground text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                Next <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

