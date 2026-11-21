'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountAvatar, AccountMenuBody, AccountPillSubline } from './account-menu'
import { describeAccountPlan, type SidebarSubscription } from './account-plan'

export interface UserMenuPopoverProps {
  user?: { name: string; role: string; initials: string }
  subscription?: SidebarSubscription | null
  businessLogoUrl?: string
  isCollapsed: boolean
  userMenuOpen: boolean
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>
  userMenuRef: RefObject<HTMLDivElement | null>
  onSignOut: () => void
}

export function UserMenuPopover({
  user,
  subscription,
  businessLogoUrl,
  isCollapsed,
  userMenuOpen,
  setUserMenuOpen,
  userMenuRef,
  onSignOut,
}: UserMenuPopoverProps) {
  const display = describeAccountPlan(subscription, user?.role)
  return (
    <div
      className={cn(
        'relative min-h-16 shrink-0 border-t border-border/40 transition-all duration-300 z-20',
        isCollapsed ? 'p-1.5' : 'px-3 py-2',
      )}
      ref={userMenuRef}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setUserMenuOpen((prev) => !prev)}
        className={cn(
          'group/user flex items-center rounded-xl transition-all duration-200 cursor-pointer w-full text-left focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
          isCollapsed
            ? 'justify-center p-1.5 hover:bg-accent/60'
            : 'p-1.5 hover:bg-accent/60 gap-2',
          userMenuOpen && 'bg-accent/80 ring-1 ring-border',
        )}
        aria-expanded={userMenuOpen}
        aria-label="User profile and menu"
      >
        <AccountAvatar
          user={user}
          businessLogoUrl={businessLogoUrl}
          className="size-8 text-[11px] transition-transform duration-200 group-hover/user:scale-105"
        />

        <div
          className={cn(
            'min-w-0 flex-1 flex flex-col items-start leading-none transition-all duration-300 ease-in-out origin-left overflow-hidden whitespace-nowrap',
            isCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-36',
          )}
        >
          <p className="truncate max-w-full text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">
            {user?.name || 'User'}
          </p>
          <AccountPillSubline display={display} role={user?.role} />
        </div>

        {!isCollapsed && (
          <ChevronsUpDown className="size-3.5 text-muted-foreground/60 shrink-0 group-hover/user:text-foreground transition-colors ml-auto" />
        )}
      </button>

      {userMenuOpen && (
        <div
          className={cn(
            'absolute z-50 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl p-2 shadow-2xl shadow-indigo-500/10 transition-all duration-150 animate-in fade-in-0 zoom-in-95',
            isCollapsed
              ? 'left-[72px] bottom-1 w-64'
              : 'bottom-full mb-2 left-1.5 right-1.5 min-w-[190px]',
          )}
        >
          <AccountMenuBody
            user={user}
            businessLogoUrl={businessLogoUrl}
            display={display}
            onNavigate={() => setUserMenuOpen(false)}
            onSignOut={() => {
              setUserMenuOpen(false)
              onSignOut()
            }}
          />
        </div>
      )}
    </div>
  )
}
