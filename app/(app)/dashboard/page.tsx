import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  TrendingUp,
  IndianRupee,
  Clock,
  FileText,
  Plus,
  FilePlus,
  UserPlus,
  PackagePlus,
  ArrowRight,
  Search,
  BarChart3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/app/stat-card'
import { InvoiceStatusBadge } from '@/components/invoice/invoice-status-badge'
import { getDashboardStats } from '@/lib/actions/reports/get-dashboard-stats'
import { getRecentInvoices } from '@/lib/actions/reports/get-recent-invoices'
import { getSalesByPeriod } from '@/lib/actions/reports/get-sales-by-period'
import { getSalesByFinancialYear } from '@/lib/actions/reports/get-sales-by-financial-year'
import { getCurrentAppUser } from '@/lib/auth/session'
import { getCurrentBusiness } from '@/lib/auth/current-business'
import { stateTaxLabel } from '@/lib/gst/indian-states'
import { getCurrentFinancialYearRange } from '@/lib/reports/period'
import { formatPaiseAsInr } from '@/lib/money'
import { canEditBusinessData } from '@/lib/auth/rbac'
import { DashboardChart } from '@/components/app/dashboard-chart-lazy'
import { cn } from '@/lib/utils'

/** Label for the recent-invoices status badge (same mapping on the phone cards and the desktop table). */
function recentStatusLabel(status: string) {
  return status === 'draft' ? 'Draft'
    : status === 'sent' ? 'Sent'
    : status === 'paid' ? 'Paid'
    : status === 'refund_due' ? 'Refund Due'
    : status === 'partially_paid' ? 'Partial'
    : 'Overdue'
}

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const user = await getCurrentAppUser()
  
  if (!user || !user.business_id) {
    redirect('/settings')
  }

  const canEdit = canEditBusinessData(user.role)

  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 11) // Last 12 months

  const fyRange = getCurrentFinancialYearRange(end)
  const fyStart = new Date(fyRange.startDate)

  // Start date is the earlier of start of 12 months ago or start of current FY
  const startDateVal = start < fyStart ? start : fyStart
  const startDateStr = `${startDateVal.getFullYear()}-${String(startDateVal.getMonth() + 1).padStart(2, '0')}-01`
  const endDateStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()).padStart(2, '0')}`

  const [business, statsRes, recentInvoicesRes, salesByPeriodRes, fySalesRes] = await Promise.all([
    getCurrentBusiness(),
    getDashboardStats({}),
    getRecentInvoices({ limit: 3 }), // Fetch latest 3 invoices to align with Quick Actions card height
    getSalesByPeriod({ startDate: startDateStr, endDate: endDateStr }),
    getSalesByFinancialYear({}),
  ])

  if (!statsRes.success || !recentInvoicesRes.success || !salesByPeriodRes.success || !fySalesRes.success) {
    return <div className="p-8 text-destructive font-semibold">Failed to load dashboard data.</div>
  }

  const taxLabel = stateTaxLabel(business?.state_code)
  const stats = statsRes.data
  const recentInvoices = recentInvoicesRes.data
  const salesData = salesByPeriodRes.data
  const fySalesData = fySalesRes.data

  // Calculate greeting based on Indian Standard Time hour
  const currentHour = new Date().getHours()
  let greeting = 'Good evening'
  if (currentHour < 12) {
    greeting = 'Good morning'
  } else if (currentHour < 17) {
    greeting = 'Good afternoon'
  }
  const userName = user?.display_name || 'User'

  // Extract current month's GST performance from salesByPeriod query
  const currentMonthKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
  const currentMonthSales = salesData.find((d) => d.key === currentMonthKey) || {
    subtotal: 0,
    total_cgst: 0,
    total_sgst: 0,
    total_igst: 0,
    total_tax: 0,
    grand_total: 0,
  }

  return (
    <div className="w-full space-y-4.5">
      {/* Dynamic welcome header with quick action panel */}
      <div className="mb-3.5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground font-heading tracking-tight text-balance">
            {greeting}, {userName} 👋
          </h1>
          <p className="mt-0.5 text-sm sm:text-base text-muted-foreground font-medium">
            Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <form action="/invoices" method="GET" className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              name="search"
              placeholder="Search invoice no. or customer…"
              className="h-8.5 w-64 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-8.5 pr-3 text-xs text-[#0F172A] placeholder:text-[#94A3B8] transition-all focus:w-72 focus:border-[#4F46E5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/10"
            />
          </form>

          {canEdit && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Link href="/customers/new" className="min-w-0 sm:shrink-0">
                <Button variant="outline" className="w-full sm:w-auto h-9.5 sm:h-8.5 px-3 rounded-lg font-bold text-sm cursor-pointer transition-transform hover:-translate-y-px active:translate-y-px whitespace-nowrap shrink-0">
                  <Plus className="size-3.5 shrink-0" strokeWidth={2} /> <span className="whitespace-nowrap">Add Customer</span>
                </Button>
              </Link>
              <Link href="/invoices/new" className="min-w-0 sm:shrink-0">
                <Button className="w-full sm:w-auto h-9.5 sm:h-8.5 px-3 rounded-lg font-bold text-sm bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-md hover:shadow-lg cursor-pointer transition-all hover:-translate-y-px active:translate-y-px whitespace-nowrap shrink-0">
                  <Plus className="size-3.5 shrink-0" strokeWidth={2} /> <span className="whitespace-nowrap">New Invoice</span>
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Row 1 — Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
        <StatCard
          label="Yearly Revenue"
          value={formatPaiseAsInr(stats.revenueThisFyPaise)}
          subtext={stats.revenueThisFyLabel}
          icon={<TrendingUp className="size-4" strokeWidth={2} />}
          variant="indigo"
        />
        <StatCard
          label="Monthly Revenue"
          value={formatPaiseAsInr(stats.revenueThisMonthPaise)}
          subtext={stats.revenueThisMonthLabel}
          icon={<IndianRupee className="size-4" strokeWidth={2} />}
          variant="green"
        />
        <StatCard
          label="Outstanding"
          value={formatPaiseAsInr(stats.outstandingTotalPaise)}
          icon={<Clock className="size-4" strokeWidth={2} />}
          variant="amber"
          subtextBadge={
            stats.overdueCount === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border-[3px] border-emerald-300 bg-white px-2 py-0.5 text-xs font-bold text-emerald-700">
                0 Overdue ✓
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border-[3px] border-amber-300 bg-white px-2 py-0.5 text-xs font-bold text-amber-700 animate-pulse">
                {stats.overdueCount} Overdue
              </span>
            )
          }
        />
        <StatCard
          label="Total Invoices"
          value={stats.totalFinalizedCount.toString()}
          icon={<FileText className="size-4" strokeWidth={2} />}
          variant="blue"
          subtextBadge={
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {stats.draftCount} Drafts
            </span>
          }
        />
      </div>

      {/* Row 2 — Interactive Charts & GST breakdown */}
      <div className="mt-2.5 grid gap-3 xl:grid-cols-3">
        {/* Left Side Chart wrapper component */}
        <div className="xl:col-span-2">
          <DashboardChart
            initialSalesData={salesData}
            fySalesData={fySalesData}
            currentFyLabel={stats.revenueThisFyLabel}
          />
        </div>

        {/* Right Side Live GST Summary Card */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm flex flex-col justify-between h-full">
          <div>
            <h3 className="text-base font-bold text-foreground font-heading tracking-tight">
              GST Summary
            </h3>
            <p className="text-xs font-medium text-muted-foreground mt-0.5">
              Collected in {stats.revenueThisMonthLabel}
            </p>
          </div>

          <div className="mt-2.5 flex-1 flex flex-col gap-0 justify-center">
            {[
              { label: 'Taxable Value', amount: currentMonthSales.subtotal, color: 'bg-indigo-500' },
              { label: 'CGST', amount: currentMonthSales.total_cgst, color: 'bg-emerald-500' },
              { label: taxLabel, amount: currentMonthSales.total_sgst, color: 'bg-amber-500' },
              { label: 'IGST', amount: currentMonthSales.total_igst, color: 'bg-rose-500' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-dashed border-border/40 last:border-0">
                <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', item.color)} />
                  {item.label}
                </span>
                <span className="text-sm font-bold text-foreground">
                  {formatPaiseAsInr(item.amount * 100)}
                </span>
              </div>
            ))}
          </div>

          {/* Accent Separator */}
          <div className="-mx-4 mt-1 mb-1 h-[3px] rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500" />

          {/* Total GST */}
          <div className="pt-0.5 flex items-center justify-between">
            <span className="text-base font-extrabold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400">
              Total GST Collected
            </span>
            <span className="text-base font-extrabold font-heading text-indigo-600 dark:text-indigo-400">
              {formatPaiseAsInr(currentMonthSales.total_tax * 100)}
            </span>
          </div>
        </div>
      </div>

      {/* Row 3 — Recent Invoices List & Quick Actions grid */}
      <div className="mt-2.5 grid gap-3 xl:grid-cols-3">
        {/* Recent Invoices Panel */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm xl:col-span-2 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <div>
              <h3 className="text-base font-bold text-foreground font-heading tracking-tight">
                Recent Invoices
              </h3>
              <p className="text-xs font-semibold text-muted-foreground mt-0.5">
                Latest {recentInvoices.length} of {stats.totalFinalizedCount}
              </p>
            </div>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" className="text-sm font-bold hover:text-indigo-600 cursor-pointer h-8 px-2.5">
                View All <ArrowRight className="size-3.5 ml-1" />
              </Button>
            </Link>
          </div>

          <div className="flex-1">
            {recentInvoices.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground font-medium">
                No invoices found.
              </div>
            ) : (
              <>
              {/* Phones: one card per invoice, the same facts as the table row. */}
              <ul className="divide-y divide-border/40 md:hidden">
                {recentInvoices.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/invoices/${inv.id}`} className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/20 active:bg-muted/30">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-indigo-600">{inv.invoice_number}</p>
                        <p className="mt-0.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{inv.customer_name}</p>
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{inv.invoice_date}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[15px] font-bold text-foreground tabular-nums">{formatPaiseAsInr(inv.grand_total_paise)}</span>
                        <InvoiceStatusBadge status={recentStatusLabel(inv.status)} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Invoice No
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Customer
                    </th>
                    <th className="hidden px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider sm:table-cell whitespace-nowrap">
                      Date
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Amount
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-2 font-mono text-sm font-bold text-indigo-600 hover:underline whitespace-nowrap">
                        <Link href={`/invoices/${inv.id}`} className="whitespace-nowrap">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-[15px] font-medium text-foreground whitespace-nowrap">{inv.customer_name}</td>
                      <td className="hidden px-4 py-2 text-sm text-muted-foreground font-medium sm:table-cell whitespace-nowrap">
                        {inv.invoice_date}
                      </td>
                      <td className="px-4 py-2 text-right text-[15px] font-bold text-foreground whitespace-nowrap">
                        {formatPaiseAsInr(inv.grand_total_paise)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <InvoiceStatusBadge status={recentStatusLabel(inv.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              </>
            )}
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground font-heading tracking-tight">
              Quick Actions
            </h3>
            <p className="text-xs font-medium text-muted-foreground mt-0.5">
              Get things done faster
            </p>
          </div>

          {/* The read-only accountant only gets the Reports shortcut, so it spans the full width. */}
          <div className={cn('mt-2.5 grid gap-2.5', canEdit ? 'grid-cols-2' : 'grid-cols-1')}>
            {[
              {
                icon: FilePlus,
                label: 'New Invoice',
                desc: 'Create & send in seconds',
                href: '/invoices/new',
                color: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25'
              },
              {
                icon: UserPlus,
                label: 'Add Customer',
                desc: 'Save GSTIN & details',
                href: '/customers/new',
                color: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25'
              },
              {
                icon: PackagePlus,
                label: 'Add Product',
                desc: 'With HSN & tax rate',
                href: '/products/new',
                color: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/25'
              },
              {
                icon: BarChart3,
                label: 'View Reports',
                desc: 'GST & sales analytics',
                href: '/reports',
                color: 'bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-md shadow-blue-500/25'
              }
            ].filter((act) => canEdit || act.href === '/reports').map((act) => {
              const Icon = act.icon
              return (
                <Link
                  key={act.label}
                  href={act.href}
                  className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/40 px-3 py-2 transition-all duration-200 hover:border-indigo-500/20 hover:bg-indigo-500/5 hover:shadow-sm"
                >
                  <div className={cn('flex size-7.5 shrink-0 items-center justify-center rounded-lg', act.color)}>
                    <Icon className="size-3.5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <b className="text-sm font-bold text-foreground block leading-tight">{act.label}</b>
                    <span className="text-[11px] text-muted-foreground font-medium block leading-snug mt-0.5">
                      {act.desc}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
