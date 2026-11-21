'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
import { X, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mainNav, accountNav, adminNavItem } from './nav-items'
import { NavLink } from './nav-link'
import { AccountAvatar, AccountMenuBody, AccountPillSubline } from './account-menu'
import { describeAccountPlan, type SidebarSubscription } from './account-plan'

export interface MobileDrawerProps {
  mobileOpen: boolean
  setMobileOpen: Dispatch<SetStateAction<boolean>>
  pathname: string
  isAdminUser?: boolean
  subscription?: SidebarSubscription | null
  user?: { name: string; role: string; initials: string }
  businessLogoUrl?: string
  mobileUserMenuOpen: boolean
  setMobileUserMenuOpen: Dispatch<SetStateAction<boolean>>
  mobileUserMenuRef: RefObject<HTMLDivElement | null>
  onSignOut: () => void
}

export function MobileDrawer({
  mobileOpen,
  setMobileOpen,
  pathname,
  isAdminUser,
  subscription,
  user,
  businessLogoUrl,
  mobileUserMenuOpen,
  setMobileUserMenuOpen,
  mobileUserMenuRef,
  onSignOut,
}: MobileDrawerProps) {
  if (!mobileOpen) return null
  const display = describeAccountPlan(subscription, user?.role)
  const closeAll = () => {
    setMobileUserMenuOpen(false)
    setMobileOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden print:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-Over Drawer */}
      <aside className="fixed inset-y-0 left-0 z-50 flex w-[240px] max-w-[85vw] h-[100dvh] flex-col border-r border-border/50 bg-card shadow-2xl animate-in slide-in-from-left duration-200">
        {/* Subtle decorative background aura */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

        {/* Brand Header with Close Button */}
        <div className="brand flex items-center justify-between border-b border-border/40 px-3.5 py-3.5 gap-2 relative z-10">
          <InvoiceBizFolioLogo href="/dashboard" className="w-40" />

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close navigation menu"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Mobile Navigation List */}
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-3 space-y-0.5 relative z-10">
          <div className="flex items-center gap-2 px-1 pt-3 pb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground select-none">
              Menu
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>

          <div className="space-y-0.5">
            {mainNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                isCollapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 px-1 pt-3.5 pb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground select-none">
              Account
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>

          <div className="space-y-0.5">
            {accountNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                isCollapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
            {isAdminUser && (
              <NavLink
                item={adminNavItem}
                pathname={pathname}
                isCollapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            )}
          </div>
        </nav>

        {/* Mobile User Profile Dock */}
        <div
          className="relative border-t border-border/40 px-3 py-2 z-20 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          ref={mobileUserMenuRef}
        >
          <button
            type="button"
            onClick={() => setMobileUserMenuOpen((prev) => !prev)}
            className={cn(
              'group/user flex items-center rounded-xl p-1.5 gap-2 transition-all duration-200 cursor-pointer w-full text-left hover:bg-accent/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
              mobileUserMenuOpen && 'bg-accent/80 ring-1 ring-border',
            )}
            aria-expanded={mobileUserMenuOpen}
            aria-label="User profile and menu"
          >
            <AccountAvatar user={user} businessLogoUrl={businessLogoUrl} className="size-8 text-[11px]" />

            <div className="min-w-0 flex-1 flex flex-col items-start leading-none overflow-hidden whitespace-nowrap">
              <p className="truncate max-w-full text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {user?.name || 'User'}
              </p>
              <AccountPillSubline display={display} role={user?.role} />
            </div>

            <ChevronsUpDown className="size-3.5 text-muted-foreground/60 shrink-0 ml-auto" />
          </button>

          {mobileUserMenuOpen && (
            <div className="absolute bottom-full mb-2 left-1.5 right-1.5 min-w-[190px] z-50 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl p-2 shadow-2xl shadow-indigo-500/10 animate-in fade-in-0 zoom-in-95">
              <AccountMenuBody
                user={user}
                businessLogoUrl={businessLogoUrl}
                display={display}
                onNavigate={closeAll}
                onSignOut={() => {
                  closeAll()
                  onSignOut()
                }}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

