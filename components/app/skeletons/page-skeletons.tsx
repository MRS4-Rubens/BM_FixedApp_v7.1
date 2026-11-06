import type { JSX, ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface SkeletonShellProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

function SkeletonShell({ label, children, className = 'w-full space-y-4.5' }: SkeletonShellProps): JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Generic page placeholder: title bar + content card. */
export function GenericPageSkeleton({ label = 'Loading page' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <div className="space-y-2 pt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    </SkeletonShell>
  );
}

const DASHBOARD_STATS = [0, 1, 2, 3] as const;
const RECENT_ROWS = [0, 1, 2] as const;

/** Dashboard placeholder: greeting + stat grid + charts + recent invoices. */
export function DashboardSkeleton({ label = 'Loading dashboard' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      {/* Welcome header row */}
      <div className="mb-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2.5">
          <Skeleton className="hidden md:block h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* 4-col stat grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {DASHBOARD_STATS.map((idx) => (
          <div key={idx} className="rounded-xl border bg-card p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-7 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Charts + side card */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-28" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>

      {/* Recent invoices */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="divide-y divide-border/60">
          {RECENT_ROWS.map((idx) => (
            <div key={idx} className="py-3 flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

const TABLE_ROWS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** List page placeholder: header + toolbar + data table (~8 rows). */
export function ListPageSkeleton({ label = 'Loading list' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      {/* Header and action bar */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 sm:gap-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2.5 bg-card p-2.5 sm:p-3 rounded-xl border border-border/70 shadow-xs flex-1 lg:max-w-4xl w-full">
          <Skeleton className="h-9 flex-1 w-full sm:max-w-xs" />
          <div className="flex gap-2 w-full sm:w-auto">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>

      {/* Table container */}
      <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
        {/* Table header */}
        <div className="border-b bg-muted/40 p-3 flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        {/* Table body */}
        <div className="divide-y divide-border/60">
          {TABLE_ROWS.map((idx) => (
            <div key={idx} className="p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-4 w-28 hidden sm:block" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="size-7 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

const REPORT_CARDS = [0, 1, 2, 3] as const;
const REPORT_ROWS = [0, 1, 2, 3, 4] as const;

/** Reports page placeholder: header + period filter + stats + chart + table. */
export function ReportsSkeleton({ label = 'Loading reports' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {REPORT_CARDS.map((idx) => (
          <div key={idx} className="rounded-xl border bg-card p-4 shadow-xs space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>

      {/* Breakdown table */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="divide-y divide-border/60">
          {REPORT_ROWS.map((idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

const FORM_FIELDS = [0, 1, 2, 3] as const;

/** Form page placeholder: header + two-column field grid + action buttons. */
export function FormPageSkeleton({ label = 'Loading form' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-8 w-48" />
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-xs space-y-6">
        <div className="space-y-2 border-b pb-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FORM_FIELDS.map((idx) => (
            <div key={idx} className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </SkeletonShell>
  );
}

const DETAIL_LINE_ITEMS = [0, 1, 2] as const;

/** Detail page placeholder: header + summary card + line items table + totals. */
export function DetailPageSkeleton({ label = 'Loading details' }: { readonly label?: string }): JSX.Element {
  return (
    <SkeletonShell label={label}>
      {/* Header controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Main detail layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Document View */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <div className="flex justify-between border-b pb-4">
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="size-16 rounded-lg" />
            </div>

            <div className="divide-y divide-border/60">
              {DETAIL_LINE_ITEMS.map((idx) => (
                <div key={idx} className="py-3 flex justify-between">
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>

            <div className="border-t pt-4 flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-6 w-28" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sidebar Hub */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-xs space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-xs space-y-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>
    </SkeletonShell>
  );
}

