'use client'

import { useId, type RefObject, type Dispatch, type SetStateAction } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
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
  const navigationId = useId()
  const toggleLabel = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <aside
      className={cn(
        'relative hidden md:flex h-full shrink-0 flex-col border-r border-border/50 bg-card/85 backdrop-blur-xl shadow-xs print:hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        isCollapsed ? 'w-[68px]' : 'w-[220px]',
      )}
    >
      {/* Subtle decorative background aura */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

      {/* Brand Header */}
      <div
        className={cn(
          'brand flex items-center border-b border-border/40 transition-all duration-300 relative z-10',
          isCollapsed ? 'justify-center px-2 py-3.5' : 'px-3.5 py-3.5 gap-2',
        )}
      >
        <InvoiceBizFolioLogo
          href="/dashboard"
          variant={isCollapsed ? 'icon' : 'compact'}
          className={isCollapsed ? 'w-8' : 'w-40'}
        />
      </div>

      {/* Navigation List */}
      <nav
        id={navigationId}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto pb-3 transition-all duration-300 relative z-10',
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
          isOwner={user ? user.role === 'owner' : undefined}
        />
      </nav>

      {/* [DESIGN-SYSTEM-LOCK: Bottom Sidebar Toggle]
          Keep the 36px button at a constant 16px left inset, centered above the avatar.
          This 52px row never scrolls; only the panel glyph animates inside the button. */}
      <div className="relative z-10 flex h-[52px] shrink-0 items-center justify-start px-4">
        <Tooltip content={toggleLabel} side="right" sideOffset={12}>
          <button
            type="button"
            onClick={handleToggle}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card cursor-pointer select-none motion-reduce:transition-none"
            aria-label={toggleLabel}
            aria-expanded={!isCollapsed}
            aria-controls={navigationId}
          >
            <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <rect
                x="4.5" y="6.5" width="4.5" height="11" rx="1" fill="currentColor" fillOpacity="0.12" stroke="none"
                className="origin-[4.5px_12px] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: isCollapsed ? 'scaleX(0.4)' : 'scaleX(1)' }}
              />
              <path
                d="M9.5 5v14"
                className="transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: isCollapsed ? 'translateX(-3px)' : 'translateX(0)' }}
              />
            </svg>
          </button>
        </Tooltip>
      </div>

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

