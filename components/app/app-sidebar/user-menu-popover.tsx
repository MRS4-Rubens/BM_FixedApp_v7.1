'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import { ChevronsUpDown, Settings, CreditCard, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface UserMenuPopoverProps {
  user?: { name: string; role: string; initials: string }
  subscription?: {
    plan: string
    status: string
    endsAt: string | null
  } | null
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
  return (
    <div
      className={cn(
        'relative border-t border-border/40 transition-all duration-300 z-20',
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
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-400 to-violet-500 text-[11px] font-bold text-white shadow-sm transition-transform duration-200 group-hover/user:scale-105 overflow-hidden border border-border/40">
          {businessLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={businessLogoUrl}
              alt="Logo"
              className="size-full object-contain p-0.5 bg-white"
            />
          ) : (
            user?.initials || 'U'
          )}
        </div>

        <div
          className={cn(
            'min-w-0 flex-1 flex flex-col leading-none transition-all duration-300 ease-in-out origin-left overflow-hidden whitespace-nowrap',
            isCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-36',
          )}
        >
          <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">
            {user?.name || 'User'}
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground capitalize mt-0.5">
            {user?.role || 'Owner'}
          </p>
        </div>

        {!isCollapsed && (
          <ChevronsUpDown className="size-3.5 text-muted-foreground/60 shrink-0 group-hover/user:text-foreground transition-colors ml-auto" />
        )}
      </button>

      {/* Interactive Popover Menu */}
      {userMenuOpen && (
        <div
          className={cn(
            'absolute z-50 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl p-2 shadow-2xl shadow-indigo-500/10 transition-all duration-150 animate-in fade-in-0 zoom-in-95',
            isCollapsed
              ? 'left-[72px] bottom-1 w-64'
              : 'bottom-full mb-2 left-1.5 right-1.5 min-w-[190px]',
          )}
        >
          {/* Popover Header with User Details */}
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-muted/40 mb-1 border border-border/40">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-400 to-violet-500 text-xs font-bold text-white shadow-sm overflow-hidden border border-border/40">
              {businessLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={businessLogoUrl}
                  alt="Logo"
                  className="size-full object-contain p-0.5 bg-white"
                />
              ) : (
                user?.initials || 'U'
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground truncate">
                {user?.name || 'User'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 capitalize">
                  {user?.role || 'Owner'}
                </span>
                {subscription?.plan && (
                  <span className="text-[10px] text-muted-foreground capitalize">
                    • {subscription.plan}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Popover Quick Links */}
          <div className="space-y-0.5 py-1">
            <Link
              href="/settings"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="size-3.5 text-muted-foreground" />
              <span>Account Settings</span>
            </Link>
            <Link
              href="/settings?tab=Billing & Usage"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
            >
              <CreditCard className="size-3.5 text-muted-foreground" />
              <span>Billing & Plan</span>
            </Link>
          </div>

          <div className="h-px bg-border/60 my-1" />

          {/* Prominent Sign Out Button */}
          <button
            type="button"
            onClick={() => {
              setUserMenuOpen(false)
              onSignOut()
            }}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 w-full text-left transition-colors cursor-pointer group"
          >
            <LogOut className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  )
}

