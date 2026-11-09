'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowDownRight,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Pencil,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/app/empty-state';
import { PaginationControls } from '@/components/app/pagination-controls';
import { DeleteDraftButton } from '@/components/app/invoices/delete-draft-button';
import { openSignedPdf } from '@/lib/pdf/open-signed-pdf';
import { getArchivedPdfUrl } from '@/lib/actions/invoices/get-archived-pdf-url';
import { getArchivedCreditNotePdfUrl } from '@/lib/actions/credit-notes/get-archived-credit-note-pdf-url';
import type { InvoiceListItem } from '@/lib/actions/invoices/list-invoices';
import type { CreditNoteListItem } from '@/lib/actions/credit-notes/list-credit-notes';
import { defaultListPeriod, type InvoiceListStatus } from '@/lib/invoices/list-filters';
import type { InvoiceListParams } from '@/lib/invoices/list-params';
import { getDisplayInvoiceStatus, getDisplayStatusLabel } from '@/lib/invoices/status';
import type { Page } from '@/lib/pagination/keyset';
import { buildListHref } from '@/lib/pagination/url';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function formatINR(amount: number): string {
  return '₹' + (amount / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateInput: string | Date | null): string {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-gradient-to-br from-orange-500 to-amber-500',
    'bg-gradient-to-br from-emerald-500 to-teal-600',
    'bg-gradient-to-br from-violet-500 to-indigo-600',
    'bg-gradient-to-br from-sky-500 to-cyan-600',
    'bg-gradient-to-br from-pink-500 to-rose-500',
    'bg-gradient-to-br from-fuchsia-500 to-purple-600',
    'bg-gradient-to-br from-blue-500 to-indigo-600',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export interface InvoicesClientProps {
  readonly invoicesPage: Page<InvoiceListItem>;
  readonly creditNotesPage: Page<CreditNoteListItem>;
  readonly businessStateCode: string;
  readonly activeTab: 'invoices' | 'credit_notes';
  readonly previousHref: string | null;
  readonly nextHref: string | null;
  readonly currentParams: InvoiceListParams;
}

export function InvoicesClient({
  invoicesPage,
  creditNotesPage,
  businessStateCode,
  activeTab,
  previousHref,
  nextHref,
  currentParams,
}: InvoicesClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [listError, setListError] = useState<string | null>(null);

  const [search, setSearch] = useState(currentParams.q ?? '');
  const [prevQ, setPrevQ] = useState(currentParams.q ?? '');
  if (prevQ !== (currentParams.q ?? '')) {
    setPrevQ(currentParams.q ?? '');
    setSearch(currentParams.q ?? '');
  }

  const [selectedMonth, setSelectedMonth] = useState(currentParams.month - 1);
  const [prevMonth, setPrevMonth] = useState(currentParams.month - 1);
  if (prevMonth !== currentParams.month - 1) {
    setPrevMonth(currentParams.month - 1);
    setSelectedMonth(currentParams.month - 1);
  }

  const [selectedYear, setSelectedYear] = useState(currentParams.year);
  const [prevYear, setPrevYear] = useState(currentParams.year);
  if (prevYear !== currentParams.year) {
    setPrevYear(currentParams.year);
    setSelectedYear(currentParams.year);
  }

  // 300ms debounced search driving router.replace (drops after/before)
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (currentParams.q ?? '')) {
      return;
    }

    const timer = setTimeout(() => {
      const targetHref = buildListHref('/invoices', {
        tab: activeTab,
        q: trimmed || undefined,
        status: activeTab === 'invoices' && currentParams.status !== 'all' ? currentParams.status : undefined,
        month: currentParams.month,
        year: currentParams.year,
      });

      startTransition(() => {
        router.replace(targetHref);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [search, activeTab, currentParams.status, currentParams.month, currentParams.year, currentParams.q, router]);

  function handleApply() {
    const targetHref = buildListHref('/invoices', {
      tab: activeTab,
      q: search.trim() || undefined,
      status: activeTab === 'invoices' && currentParams.status !== 'all' ? currentParams.status : undefined,
      month: selectedMonth + 1,
      year: selectedYear,
    });
    startTransition(() => {
      router.replace(targetHref);
    });
  }

  function handleClear() {
    setSearch('');
    const defaults = defaultListPeriod();
    setSelectedMonth(defaults.month - 1);
    setSelectedYear(defaults.year);
    const targetHref = buildListHref('/invoices', {
      tab: activeTab,
    });
    startTransition(() => {
      router.replace(targetHref);
    });
  }

  function handleStatusChange(nextStatus: InvoiceListStatus) {
    const targetHref = buildListHref('/invoices', {
      tab: 'invoices',
      q: search.trim() || undefined,
      status: nextStatus !== 'all' ? nextStatus : undefined,
      month: currentParams.month,
      year: currentParams.year,
    });
    startTransition(() => {
      router.replace(targetHref);
    });
  }

  function handleTabChange(tab: 'invoices' | 'credit_notes') {
    if (tab === activeTab) return;
    const targetHref = buildListHref('/invoices', {
      tab,
      month: currentParams.month,
      year: currentParams.year,
    });
    startTransition(() => {
      router.replace(targetHref);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 sm:gap-4">
        {/* Left Side: Heading & Justified Tagline */}
        <div className="flex flex-col gap-0.5 sm:gap-1 shrink-0">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
            INVOICES
          </h1>
          <p className="text-xs sm:text-sm font-semibold text-muted-foreground leading-relaxed max-w-sm sm:max-w-md">
            Effortlessly Track, Organize, Maintain, and Download All Your Tax Invoices in One Place
          </p>
        </div>

        {/* Right Side: Filter and Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 bg-card p-2.5 sm:p-3 rounded-xl border border-border/70 shadow-xs flex-1 lg:max-w-4xl w-full">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm w-full sm:max-w-xs focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all shadow-sm">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder={activeTab === 'invoices' ? "Search by customer, invoice #..." : "Search by CN #, invoice #, customer..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none min-w-0"
            />
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
            {activeTab === 'invoices' && (
              <div className="relative">
                <select
                  aria-label="Filter by invoice status"
                  value={currentParams.status}
                  onChange={(e) => handleStatusChange(e.target.value as InvoiceListStatus)}
                  className="w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-8 h-9 text-[13px] sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer min-w-[110px] shadow-sm font-semibold hover:bg-accent/40 transition-colors"
                >
                  <option value="all">All Statuses</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="draft">Draft</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none size-4 text-muted-foreground" />
              </div>
            )}

            <div className="relative">
              <select
                aria-label="Filter by month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-8 h-9 text-[13px] sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer min-w-[96px] shadow-sm font-semibold hover:bg-accent/40 transition-colors"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none size-4 text-muted-foreground" />
            </div>

            <div className="relative">
              <select
                aria-label="Filter by year"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-8 h-9 text-[13px] sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer min-w-[86px] shadow-sm font-semibold hover:bg-accent/40 transition-colors"
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none size-4 text-muted-foreground" />
            </div>

            <Button
              onClick={handleApply}
              className="w-full sm:w-auto h-9 px-4 text-[13px] sm:text-sm font-bold shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer"
            >
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={handleClear}
              className="w-full sm:w-auto h-9 px-4 text-[13px] sm:text-sm font-semibold shadow-sm hover:bg-accent cursor-pointer"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      {listError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <div className="flex-1">{listError}</div>
          <button type="button" onClick={() => setListError(null)} aria-label="Dismiss message" className="text-destructive/70 hover:text-destructive cursor-pointer">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Tabs: Tax Invoices vs Credit Notes & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 border-b border-border pb-1.5">
        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleTabChange('invoices')}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs sm:text-[14px] font-bold rounded-lg transition-all cursor-pointer border text-center justify-center flex items-center",
              activeTab === 'invoices'
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            Tax Invoices ({invoicesPage.totalCount})
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('credit_notes')}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs sm:text-[14px] font-bold rounded-lg transition-all cursor-pointer border flex items-center justify-center gap-1.5 text-center",
              activeTab === 'credit_notes'
                ? "bg-red-600 text-white border-red-700 shadow-xs"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            Credit Notes ({creditNotesPage.totalCount})
          </button>
        </div>

        <Link href="/invoices/new" className="w-full sm:w-auto">
          <Button
            className="w-full sm:w-auto shadow-md bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-[13px] sm:text-sm font-bold h-9 px-4 rounded-lg cursor-pointer transition-all hover:shadow-lg hover:-translate-y-px active:translate-y-px flex items-center justify-center gap-1.5"
          >
            <Plus className="size-4" />
            New Invoice
          </Button>
        </Link>
      </div>

      {/* Main Tab Content */}
      <div className={cn("transition-opacity duration-150", isPending && "opacity-60 pointer-events-none")}>
        {activeTab === 'invoices' ? (
          <div>
            <p className="text-[13px] sm:text-sm text-muted-foreground px-1 mb-1.5 font-medium">
              Showing {invoicesPage.items.length} of {invoicesPage.totalCount} invoice{invoicesPage.totalCount !== 1 ? 's' : ''} for <span className="font-semibold text-foreground">{MONTHS[currentParams.month - 1]} {currentParams.year}</span>
            </p>

            {invoicesPage.items.length === 0 ? (
              <EmptyState
                icon={<FileText className="size-6" />}
                title="No invoices found"
                description={`No invoices registered for ${MONTHS[currentParams.month - 1]} ${currentParams.year}. Try a different period or create one.`}
                action={{ label: 'Create Invoice', href: '/invoices/new' }}
              />
            ) : (
              <>
                {/* Desktop / Tablet View: High-Density ERP Table (>= 768px) */}
                <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Invoice #</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Date</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Customer</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Supply Type</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Grand Total</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Status</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoicesPage.items.map((inv) => {
                          const isIntra = inv.place_of_supply_state_code === businessStateCode;
                          return (
                            <tr key={inv.id} className="border-b border-border last:border-0 transition-colors hover:bg-muted/10">
                              <td className="px-3.5 py-[3px]">
                                <div className="relative -left-[3px]">
                                  {inv.lifecycle_status === 'draft' ? (
                                    <span className="inline-flex items-center rounded bg-muted/60 px-2 py-0.5 font-mono text-[13px] font-bold text-muted-foreground border border-border/50 uppercase tracking-wide">
                                      DRAFT
                                    </span>
                                  ) : (
                                    <Link href={`/invoices/${inv.id}`}>
                                      <span className="inline-flex items-center rounded-md bg-indigo-100/70 px-2 py-[1px] font-mono text-[15px] font-bold tracking-wide text-indigo-700 ring-1 ring-indigo-200 transition-all duration-200 hover:bg-indigo-200/70">
                                        {inv.invoice_number}
                                      </span>
                                    </Link>
                                  )}
                                </div>
                              </td>
                              <td className="px-3.5 py-1 text-[13px] text-muted-foreground whitespace-nowrap font-medium">
                                {formatDate(inv.invoice_date)}
                              </td>
                              <td className="px-3.5 py-1">
                                <div className="flex items-center gap-2">
                                  <div
                                    className={cn(
                                      'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-xs',
                                      getAvatarColor(inv.customer_name)
                                    )}
                                  >
                                    {getInitials(inv.customer_name)}
                                  </div>
                                  <span className="text-[13px] font-semibold text-foreground truncate max-w-[170px]">
                                    {inv.customer_name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3.5 py-1">
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border shadow-2xs leading-tight',
                                    isIntra
                                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  )}
                                >
                                  {isIntra ? 'Intra-State' : 'Inter-State'}
                                </span>
                              </td>
                              <td className="px-3.5 py-1 text-right font-mono text-[13px] sm:text-[14px] font-bold text-foreground">
                                {formatINR(inv.grand_total_paise)}
                              </td>
                              <td className="px-3.5 py-1">
                                {(() => {
                                  const displayStatus = getDisplayInvoiceStatus(inv);
                                  const { label, colorClass } = getDisplayStatusLabel(displayStatus);
                                  return (
                                    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-2xs leading-tight', colorClass)}>
                                      {label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-3.5 py-1">
                                <div className="flex items-center justify-center gap-1">
                                  {inv.lifecycle_status === 'draft' ? (
                                    <>
                                      <Link
                                        href={`/invoices/${inv.id}`}
                                        title="Edit Draft"
                                        className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm"
                                      >
                                        <Pencil className="size-3.5" />
                                      </Link>
                                      <DeleteDraftButton invoiceId={inv.id} variant="icon" onError={setListError} />
                                    </>
                                  ) : (
                                    <>
                                      <Link
                                        href={`/invoices/${inv.id}`}
                                        title="View Invoice"
                                        className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm"
                                      >
                                        <Eye className="size-3.5" />
                                      </Link>
                                      <button
                                        onClick={async (e) => {
                                          e.preventDefault();
                                          const r = await openSignedPdf(() => getArchivedPdfUrl({ id: inv.id }));
                                          if (!r.ok) setListError(r.message); else setListError(null);
                                        }}
                                        title="Download PDF"
                                        className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm cursor-pointer"
                                      >
                                        <Download className="size-3.5" />
                                      </button>
                                      <Link
                                        href={`/invoices/${inv.id}?print=true`}
                                        title="Print Invoice"
                                        className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm"
                                      >
                                        <Printer className="size-3.5" />
                                      </Link>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile View: Touch-Friendly Card Stack (< 768px) */}
                <div className="md:hidden space-y-2.5">
                  {invoicesPage.items.map((inv) => {
                    const isIntra = inv.place_of_supply_state_code === businessStateCode;
                    const displayStatus = getDisplayInvoiceStatus(inv);
                    const { label, colorClass } = getDisplayStatusLabel(displayStatus);

                    return (
                      <div
                        key={inv.id}
                        className="bg-card rounded-xl border border-border/80 p-3.5 shadow-2xs transition-all space-y-3"
                      >
                        {/* Top Row: Invoice # + Status Badge */}
                        <div className="flex items-center justify-between gap-2">
                          {inv.lifecycle_status === 'draft' ? (
                            <span className="inline-flex items-center rounded bg-muted/60 px-2 py-0.5 font-mono text-[12px] font-bold text-muted-foreground border border-border/50 uppercase tracking-wide">
                              DRAFT
                            </span>
                          ) : (
                            <Link href={`/invoices/${inv.id}`}>
                              <span className="inline-flex items-center rounded-md bg-indigo-100/70 px-2 py-0.5 font-mono text-[14px] font-bold tracking-wide text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-200/70">
                                {inv.invoice_number}
                              </span>
                            </Link>
                          )}

                          <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-2xs leading-tight', colorClass)}>
                            {label}
                          </span>
                        </div>

                        {/* Middle Row: Customer Avatar, Name, Supply Type & Grand Total */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div
                              className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-xs',
                                getAvatarColor(inv.customer_name)
                              )}
                            >
                              {getInitials(inv.customer_name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-bold text-foreground truncate">
                                {inv.customer_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded px-1.5 py-0.2 text-[9.5px] font-bold uppercase tracking-wider border leading-none',
                                    isIntra
                                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  )}
                                >
                                  {isIntra ? 'Intra' : 'Inter'}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-medium">
                                  • {formatDate(inv.invoice_date)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                              Total
                            </span>
                            <span className="font-mono text-[15px] font-extrabold text-foreground">
                              {formatINR(inv.grand_total_paise)}
                            </span>
                          </div>
                        </div>

                        {/* Bottom Action Row */}
                        <div className="pt-2 border-t border-border/50 flex items-center justify-end gap-1.5">
                          {inv.lifecycle_status === 'draft' ? (
                            <>
                              <Link
                                href={`/invoices/${inv.id}`}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors"
                              >
                                <Pencil className="size-3.5 text-muted-foreground" />
                                <span>Edit Draft</span>
                              </Link>
                              <DeleteDraftButton invoiceId={inv.id} variant="icon" onError={setListError} />
                            </>
                          ) : (
                            <>
                              <Link
                                href={`/invoices/${inv.id}`}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors"
                              >
                                <Eye className="size-3.5 text-muted-foreground" />
                                <span>View</span>
                              </Link>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  const r = await openSignedPdf(() => getArchivedPdfUrl({ id: inv.id }));
                                  if (!r.ok) setListError(r.message); else setListError(null);
                                }}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors cursor-pointer"
                              >
                                <Download className="size-3.5 text-muted-foreground" />
                                <span>PDF</span>
                              </button>
                              <Link
                                href={`/invoices/${inv.id}?print=true`}
                                className="flex items-center justify-center size-8 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent shadow-2xs transition-colors"
                                title="Print Invoice"
                              >
                                <Printer className="size-3.5" />
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <PaginationControls
                  shown={invoicesPage.items.length}
                  total={invoicesPage.totalCount}
                  previousHref={previousHref}
                  nextHref={nextHref}
                  label="invoices"
                />
              </>
            )}
          </div>
        ) : (
          /* Credit Notes Tab */
          <div>
            <p className="text-[13px] sm:text-sm text-muted-foreground px-1 mb-1.5 font-medium">
              Showing {creditNotesPage.items.length} of {creditNotesPage.totalCount} credit note{creditNotesPage.totalCount !== 1 ? 's' : ''} for <span className="font-semibold text-foreground">{MONTHS[currentParams.month - 1]} {currentParams.year}</span>
            </p>

            {creditNotesPage.items.length === 0 ? (
              <EmptyState
                icon={<ArrowDownRight className="size-6 text-red-500" />}
                title="No credit notes found"
                description={`No credit notes issued for ${MONTHS[currentParams.month - 1]} ${currentParams.year}. To issue a credit note, open any finalized invoice and click 'Issue Credit Note'.`}
              />
            ) : (
              <>
                {/* Desktop / Tablet View: High-Density ERP Table (>= 768px) */}
                <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Credit Note #</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Date</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Original Invoice</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Customer</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Reason</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Credit Amount</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left">Status</th>
                          <th className="px-3.5 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditNotesPage.items.map((note) => {
                          const isFinalized = note.lifecycle_status === 'finalized';
                          const isVoided = note.status === 'voided';
                          return (
                            <tr key={note.id} className={cn("border-b border-border last:border-0 transition-colors", isVoided ? "bg-muted/30 opacity-75 hover:opacity-90" : "hover:bg-muted/10")}>
                              <td className="px-3.5 py-[3px]">
                                <Link href={`/credit-notes/${note.id}`}>
                                  <span className={cn(
                                    "inline-flex items-center rounded-md px-2 py-[1px] font-mono text-[14px] font-bold tracking-wide transition-all duration-200",
                                    isVoided
                                      ? "bg-slate-100 text-slate-500 line-through ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800"
                                      : "bg-red-100/70 text-red-700 ring-1 ring-red-200 hover:bg-red-200/70"
                                  )}>
                                    {note.credit_note_number}
                                  </span>
                                </Link>
                              </td>
                              <td className="px-3.5 py-1 text-[13px] text-muted-foreground whitespace-nowrap font-medium">
                                {formatDate(note.issue_date || note.created_at)}
                              </td>
                              <td className="px-3.5 py-1">
                                <Link href={`/invoices/${note.original_invoice_id}`} className="font-mono text-[13px] font-bold text-primary hover:underline">
                                  {note.original_invoice_number}
                                </Link>
                              </td>
                              <td className="px-3.5 py-1">
                                <span className="text-[13px] font-semibold text-foreground truncate max-w-[170px] block">
                                  {note.billing_name_snapshot || 'Cash Customer'}
                                </span>
                              </td>
                              <td className="px-3.5 py-1 text-[13px] text-muted-foreground">
                                {note.reason}
                                {isVoided && note.void_reason && (
                                  <span className="text-rose-600 dark:text-rose-400 font-semibold block text-[11px]">
                                    Voided ({note.void_reason})
                                  </span>
                                )}
                              </td>
                              <td className={cn(
                                "px-3.5 py-1 text-right font-mono text-[13px] sm:text-[14px] font-bold",
                                isVoided ? "line-through text-muted-foreground" : "text-red-700 dark:text-red-400"
                              )}>
                                -{formatINR(note.grand_total_paise)}
                              </td>
                              <td className="px-3.5 py-1">
                                <span className={cn(
                                  "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-2xs border leading-tight",
                                  isVoided
                                    ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300"
                                    : isFinalized
                                    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
                                    : "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300"
                                )}>
                                  {isVoided ? 'VOIDED' : (isFinalized ? 'Finalized' : 'Draft')}
                                </span>
                              </td>
                              <td className="px-3.5 py-1">
                                <div className="flex items-center justify-center gap-1">
                                  <Link
                                    href={`/credit-notes/${note.id}`}
                                    title="View Credit Note"
                                    className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm"
                                  >
                                    <Eye className="size-3.5" />
                                  </Link>
                                  {isFinalized && (
                                    <button
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        const r = await openSignedPdf(() => getArchivedCreditNotePdfUrl({ id: note.id }));
                                        if (!r.ok) setListError(r.message); else setListError(null);
                                      }}
                                      title="Download PDF"
                                      className="flex size-7.5 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm cursor-pointer"
                                    >
                                      <Download className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile View: Touch-Friendly Card Stack (< 768px) */}
                <div className="md:hidden space-y-2.5">
                  {creditNotesPage.items.map((note) => {
                    const isFinalized = note.lifecycle_status === 'finalized';
                    const isVoided = note.status === 'voided';

                    return (
                      <div
                        key={note.id}
                        className={cn(
                          "bg-card rounded-xl border border-border/80 p-3.5 shadow-2xs transition-all space-y-3",
                          isVoided && "opacity-80 bg-muted/20"
                        )}
                      >
                        {/* Top Row: CN # + Status Pill */}
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/credit-notes/${note.id}`}>
                            <span className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[13.5px] font-bold tracking-wide transition-all",
                              isVoided
                                ? "bg-slate-100 text-slate-500 line-through ring-1 ring-slate-200 dark:bg-slate-900"
                                : "bg-red-100/70 text-red-700 ring-1 ring-red-200 hover:bg-red-200/70"
                            )}>
                              {note.credit_note_number}
                            </span>
                          </Link>

                          <span className={cn(
                            "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-2xs border leading-tight",
                            isVoided
                              ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300"
                              : isFinalized
                              ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
                              : "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300"
                          )}>
                            {isVoided ? 'VOIDED' : (isFinalized ? 'Finalized' : 'Draft')}
                          </span>
                        </div>

                        {/* Middle Details: Customer, Original Invoice & Credit Amount */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold text-foreground truncate">
                              {note.billing_name_snapshot || 'Cash Customer'}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                              <span className="text-muted-foreground">Against:</span>
                              <Link href={`/invoices/${note.original_invoice_id}`} className="font-mono font-bold text-primary hover:underline truncate">
                                {note.original_invoice_number}
                              </Link>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                              {note.reason}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                              Credit
                            </span>
                            <span className={cn(
                              "font-mono text-[15px] font-extrabold",
                              isVoided ? "line-through text-muted-foreground" : "text-red-600 dark:text-red-400"
                            )}>
                              -{formatINR(note.grand_total_paise)}
                            </span>
                          </div>
                        </div>

                        {/* Bottom Action Row */}
                        <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground font-medium">
                            {formatDate(note.issue_date || note.created_at)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/credit-notes/${note.id}`}
                              className="flex items-center gap-1 py-1.5 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors"
                            >
                              <Eye className="size-3.5 text-muted-foreground" />
                              <span>View</span>
                            </Link>
                            {isFinalized && (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  const r = await openSignedPdf(() => getArchivedCreditNotePdfUrl({ id: note.id }));
                                  if (!r.ok) setListError(r.message); else setListError(null);
                                }}
                                className="flex items-center gap-1 py-1.5 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-bold shadow-2xs hover:bg-accent transition-colors cursor-pointer"
                              >
                                <Download className="size-3.5 text-muted-foreground" />
                                <span>PDF</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <PaginationControls
                  shown={creditNotesPage.items.length}
                  total={creditNotesPage.totalCount}
                  previousHref={previousHref}
                  nextHref={nextHref}
                  label="credit notes"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
