import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string
  subtext?: string
  icon: ReactNode
  variant?: 'indigo' | 'green' | 'amber' | 'blue'
  subtextBadge?: ReactNode
}

const variantStyles = {
  indigo: {
    topBar: 'bg-gradient-to-r from-indigo-500 via-purple-500 to-violet-500',
    iconBg: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25',
  },
  green: {
    topBar: 'bg-gradient-to-r from-emerald-500 to-teal-500',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25',
  },
  amber: {
    topBar: 'bg-gradient-to-r from-amber-500 to-orange-500',
    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/25',
  },
  blue: {
    topBar: 'bg-gradient-to-r from-blue-500 to-cyan-500',
    iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-md shadow-blue-500/25',
  },
}

export function StatCard({
  label,
  value,
  subtext,
  icon,
  variant = 'indigo',
  subtextBadge,
}: StatCardProps) {
  const styles = variantStyles[variant]

  return (
    <div className="card-hover relative min-w-0 overflow-hidden rounded-xl border border-border bg-card px-3 py-2.5 sm:px-3.5 shadow-sm">
      {/* Dynamic top gradient bar */}
      <div className={cn('absolute top-0 left-0 right-0 h-[3px]', styles.topBar)} />

      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[10px] leading-snug sm:text-xs font-bold text-muted-foreground uppercase tracking-wide sm:tracking-wider">
          {label}
        </span>
        <div
          className={cn(
            'flex size-7 sm:size-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 hover:scale-110 hover:rotate-6',
            styles.iconBg,
          )}
        >
          {icon}
        </div>
      </div>

      {/* Phones: smaller and allowed to wrap (an amount is never cut off); wider screens: one line as before. */}
      <p className="mt-1 text-xl min-[400px]:text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-heading tabular-nums [overflow-wrap:anywhere] sm:whitespace-nowrap sm:truncate">
        {value}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {subtextBadge ? (
          subtextBadge
        ) : subtext ? (
          <span className="text-xs sm:text-sm font-medium text-muted-foreground">{subtext}</span>
        ) : null}
      </div>
    </div>
  )
}

