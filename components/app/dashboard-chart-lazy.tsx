'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export type { DashboardChartProps } from './dashboard-chart'

function DashboardChartPlaceholder() {
  return (
    <div
      className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm relative overflow-visible h-full flex flex-col justify-between"
      aria-busy="true"
    >
      <span className="sr-only">Loading revenue chart...</span>
      {/* Panel Header */}
      <div className="panel-head flex flex-wrap justify-between items-start gap-2 mb-1.5">
        {/* Heights mirror the real header (24px title row, 2px gap, 16px subtitle; 32px tab pills) so nothing
            moves when the chart replaces this placeholder (measured on the PERF-005 preview). */}
        <div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-0.5 h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-28 rounded-xl" />
      </div>

      {/* Chart Canvas Area */}
      <div className="chart-container w-full h-[170px] mt-2 relative">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </div>
  )
}

export const DashboardChart = dynamic(
  () => import('./dashboard-chart').then((m) => m.DashboardChart),
  {
    ssr: false,
    loading: () => <DashboardChartPlaceholder />,
  },
)
