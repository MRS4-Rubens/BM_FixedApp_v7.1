'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mainNav, accountNav, adminNavItem } from './nav-items'
import { NavLink } from './nav-link'
import { SubscriptionCard } from './subscription-card'
import { UserMenuPopover } from './user-menu-popover'

export interface DesktopSidebarProps {
  pathname: string
  isCollapsed: boolean
  handleToggle: () => void
  isAdminUser?: boolean
  subscription?: {
    plan: string
    status: string
    endsAt: string | null
  } | null
  daysRemaining: number | null
  user?: { name: string; role: string; initials: string }
  businessLogoUrl?: string
  userMenuOpen: boolean
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>
  userMenuRef: RefObject<HTMLDivElement | null>
  onSignOut: () => void
}

export function DesktopSidebar({
  pathname,
  isCollapsed,
  handleToggle,
  isAdminUser,
  subscription,
  daysRemaining,
  user,
  businessLogoUrl,
  userMenuOpen,
  setUserMenuOpen,
  userMenuRef,
  onSignOut,
}: DesktopSidebarProps) {
  return (
    <aside
      className={cn(
        'relative hidden md:flex h-full shrink-0 flex-col border-r border-border/50 bg-card/85 backdrop-blur-xl shadow-xs print:hidden transition-all duration-300 ease-in-out',
        isCollapsed ? 'w-[68px]' : 'w-[220px]',
      )}
    >
      {/* Subtle decorative background aura */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

      {/* [DESIGN-SYSTEM-LOCK: Compact Sidebar Toggle]
          Intentional high-density token: size-6 (24x24px) at -right-3 with size-3.5 icon.
          Idle: Clean white circle (Image 3).
          Hover: Smooth indigo glow ring (Image 2). No permanent click focus ring.
          Anchored at top-[62px] (Brand Header dividing border) so it remains ergonomically
          fixed at the top navigation on tall tablet screens (iPad Pro 1376px) instead of drifting down! */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "absolute -right-3 top-[62px] z-40 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground shadow-2xs transition-all duration-200 cursor-pointer select-none",
          "hover:border-indigo-400/60 hover:text-indigo-600 hover:ring-4 hover:ring-indigo-500/15 hover:scale-105 hover:shadow-xs",
          "active:scale-95",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        )}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronLeft className="size-3.5" />
        )}
      </button>

      {/* Brand Header */}
      <div
        className={cn(
          'brand flex items-center border-b border-border/40 transition-all duration-300 relative z-10',
          isCollapsed ? 'justify-center px-2 py-3.5' : 'px-3.5 py-3.5 gap-2',
        )}
      >
        {/* Vibrant Rounded "B" Logo Squircle */}
        <div className="logo flex size-8.5 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 font-extrabold text-white text-base shadow-[0_4px_14px_rgba(99,102,241,0.35)] border border-white/20 transition-transform duration-300 hover:rotate-[-4deg] hover:scale-105 select-none">
          B
        </div>

        <div
          className={cn(
            'flex flex-col leading-tight transition-all duration-300 ease-in-out origin-left overflow-hidden whitespace-nowrap',
            isCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-40',
          )}
        >
          <div className="flex items-center gap-1">
            <span className="text-[14.5px] font-black tracking-tight text-foreground">
              Bill
            </span>
            <span className="text-[14.5px] font-black tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-violet-600 bg-clip-text text-transparent">
              Matrix
            </span>
          </div>
          <span className="text-[9px] font-extrabold text-muted-foreground uppercase tracking-[0.16em] mt-0.5">
            GST Invoicing Suite
          </span>
        </div>
      </div>

      {/* Navigation List */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto pb-3 transition-all duration-300 relative z-10',
          isCollapsed ? 'px-3 space-y-1' : 'px-3 space-y-0.5',
        )}
      >
        {/* MENU Section Header */}
        {!isCollapsed ? (
          <div className="flex items-center gap-2 px-1 pt-3 pb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground select-none">
              Menu
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        ) : (
          <div className="h-px w-6 mx-auto bg-border/40 my-2" />
        )}

        <div className="space-y-0.5">
          {mainNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>

        {/* ACCOUNT Section Header */}
        {!isCollapsed ? (
          <div className="flex items-center gap-2 px-1 pt-3.5 pb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground select-none">
              Account
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        ) : (
          <div className="h-px w-6 mx-auto bg-border/40 my-2" />
        )}

        <div className="space-y-0.5">
          {accountNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              isCollapsed={isCollapsed}
            />
          ))}
          {isAdminUser && (
            <NavLink
              item={adminNavItem}
              pathname={pathname}
              isCollapsed={isCollapsed}
            />
          )}
        </div>

        <SubscriptionCard
          subscription={subscription}
          daysRemaining={daysRemaining}
          isCollapsed={isCollapsed}
        />
      </nav>

      {/* User profile dock & interactive popover at bottom */}
      <UserMenuPopover
        user={user}
        subscription={subscription}
        businessLogoUrl={businessLogoUrl}
        isCollapsed={isCollapsed}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        userMenuRef={userMenuRef}
        onSignOut={onSignOut}
      />
    </aside>
  )
}

