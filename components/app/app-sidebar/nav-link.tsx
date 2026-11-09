'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import type { NavItem } from './nav-items'

export function NavLink({
  item,
  pathname,
  isCollapsed,
  onNavigate,
}: {
  item: NavItem
  pathname: string
  isCollapsed: boolean
  onNavigate?: () => void
}) {
  const isActive = pathname === item.href
  const Icon = item.icon

  const linkContent = (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group flex items-center rounded-xl text-[13.5px] font-semibold transition-all relative duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 select-none',
        isActive
          ? 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-200/50 dark:border-indigo-800/40 shadow-xs'
          : 'text-slate-600 dark:text-slate-400 hover:bg-muted/70 hover:text-foreground',
        isCollapsed ? 'justify-center p-1.5 my-0.5' : 'px-2 py-1.5 my-0.5 gap-2',
      )}
    >
      {/* Active Left Indicator Bar */}
      {isActive && (
        <span
          className={cn(
            'absolute top-[18%] bottom-[18%] w-[3.5px] bg-gradient-to-b from-indigo-500 to-violet-600 rounded-r-full shadow-xs transition-all duration-300',
            isCollapsed ? '-left-2' : '-left-1',
          )}
        />
      )}

      {/* Chromatic Icon Pod */}
      <div
        className={cn(
          'size-7.5 shrink-0 flex items-center justify-center rounded-lg border transition-all duration-200 group-hover:scale-105',
          isActive
            ? cn(item.color.activeGradient, 'border-transparent')
            : cn(
                item.color.inactiveBg,
                item.color.inactiveText,
                item.color.inactiveBorder,
                'group-hover:brightness-110',
              ),
        )}
      >
        <Icon className="size-4" strokeWidth={isActive ? 2.2 : 2} />
      </div>

      {/* Label and right chevron */}
      {!isCollapsed && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-all duration-200',
              isActive
                ? 'text-indigo-600 dark:text-indigo-400 opacity-90'
                : 'text-muted-foreground/35 group-hover:text-muted-foreground group-hover:translate-x-0.5',
            )}
          />
        </>
      )}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip content={item.label} side="right" sideOffset={12}>
        {linkContent}
      </Tooltip>
    )
  }

  return linkContent
}

