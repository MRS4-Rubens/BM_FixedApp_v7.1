import type { Metadata } from 'next'
import { ReportsClient } from './client'
import { getCurrentMonthRange, getCurrentFinancialYearRange, getPreviousFinancialYearRange, getMonthRange } from '@/lib/reports/period'
import { getIstDateParts } from '@/lib/invoices/ist-date'
import { getSalesByPeriod } from '@/lib/actions/reports/get-sales-by-period'
import { getTopCustomers } from '@/lib/actions/reports/get-top-customers'
import { getTopProducts } from '@/lib/actions/reports/get-top-products'
import { getCurrentBusiness } from '@/lib/auth/current-business'
import { canExportStatutoryReport } from '@/lib/subscriptions/entitlements'
import { reportRangeMessage, reportRangeProblem } from '@/lib/reports/date-range'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage(props: { searchParams: Promise<{ period?: string; startDate?: string; endDate?: string }> }) {
  const searchParams = await props.searchParams
  let period = searchParams.period || 'this_month'

  let startDate = ''
  let endDate = ''
  let periodLabel = ''
  // BUG-02: a custom window must be two real dates, at most 366 days apart (the export limit). Anything else (a bad
  // bookmark, a typed URL) shows this month with a short notice instead of an error page or a runaway chart.
  let rangeNotice: string | null = null

  if (period === 'custom') {
    const rawStart = searchParams.startDate ?? ''
    const rawEnd = searchParams.endDate ?? ''
    // Dates typed in the wrong order are swapped, as before.
    const [from, to] = rawStart <= rawEnd ? [rawStart, rawEnd] : [rawEnd, rawStart]
    const problem = reportRangeProblem(from, to)
    if (problem === null) {
      startDate = from
      endDate = to
      periodLabel = 'Custom'
    } else {
      rangeNotice = `That date range could not be used. ${reportRangeMessage(problem)}. Showing this month instead.`
      period = 'this_month'
    }
  }

  if (period === 'custom') {
    // The valid custom window was set above (an invalid one switched `period` to this_month).
  } else if (period === 'last_month') {
    const d = new Date()
    // Need to use IST date parts so it's consistent
    const parts = getIstDateParts(d)
    let year = parts.year
    let month = parts.month - 1
    if (month === 0) {
      month = 12
      year -= 1
    }
    const range = getMonthRange(year, month)
    startDate = range.startDate
    endDate = range.endDate
    periodLabel = range.label
  } else if (period === 'this_fy') {
    const range = getCurrentFinancialYearRange()
    startDate = range.startDate
    endDate = range.endDate
    periodLabel = range.label
  } else if (period === 'prev_fy') {
    const range = getPreviousFinancialYearRange()
    startDate = range.startDate
    endDate = range.endDate
    periodLabel = range.label
  } else {

    // Default: this_month
    const range = getCurrentMonthRange()
    startDate = range.startDate
    endDate = range.endDate
    periodLabel = range.label
  }

  const [salesDataRes, topCustomersRes, topProductsRes] = await Promise.all([
    getSalesByPeriod({ startDate, endDate }),
    getTopCustomers({ startDate, endDate, limit: 3 }),
    getTopProducts({ startDate, endDate, limit: 3 })
  ])
  
  if (!salesDataRes.success || !topCustomersRes.success || !topProductsRes.success) {
    return <div className="p-8 text-destructive">Failed to load reports data.</div>
  }

  const salesData = salesDataRes.data
  const topCustomers = topCustomersRes.data
  const topProducts = topProductsRes.data

  const business = await getCurrentBusiness()
  let canExport = false
  if (business) {
    canExport = canExportStatutoryReport(business).allowed
  }

  return (
    <ReportsClient 
      salesData={salesData} 
      topCustomers={topCustomers} 
      topProducts={topProducts} 
      currentPeriod={period}
      periodLabel={periodLabel}
      startDate={startDate}
      endDate={endDate}
      canExport={canExport}
      rangeNotice={rangeNotice}
    />
  )
}
