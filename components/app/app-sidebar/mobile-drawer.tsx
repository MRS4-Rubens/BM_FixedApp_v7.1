'use client'

import type { RefObject, Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
import { X, ChevronsUpDown, Settings, CreditCard, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mainNav, accountNav, adminNavItem } from './nav-items'
import { NavLink } from './nav-link'
import { SubscriptionCard } from './subscription-card'
import { roleLabel } from '@/components/app/current-user-role'

export interface MobileDrawerProps {
  mobileOpen: boolean
  setMobileOpen: Dispatch<SetStateAction<boolean>>
  pathname: string
  isAdminUser?: boolean
  subscription?: {
    plan: string
    status: string
    endsAt: string | null
  } | null
  daysRemaining: number | null
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
  daysRemaining,
  user,
  businessLogoUrl,
  mobileUserMenuOpen,
  setMobileUserMenuOpen,
  mobileUserMenuRef,
  onSignOut,
}: MobileDrawerProps) {
  if (!mobileOpen) return null

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
        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5 relative z-10">
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

          <SubscriptionCard
            subscription={subscription}
            daysRemaining={daysRemaining}
            isCollapsed={false}
            onCardNavigate={() => setMobileOpen(false)}
            isOwner={user ? user.role === 'owner' : undefined}
          />
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
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-400 to-violet-500 text-[11px] font-bold text-white shadow-sm overflow-hidden border border-border/40">
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

            <div className="min-w-0 flex-1 flex flex-col leading-none overflow-hidden whitespace-nowrap">
              <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {user?.name || 'User'}
              </p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">
                {roleLabel(user?.role)}
              </p>
            </div>

            <ChevronsUpDown className="size-3.5 text-muted-foreground/60 shrink-0 ml-auto" />
          </button>

          {mobileUserMenuOpen && (
            <div className="absolute bottom-full mb-2 left-1.5 right-1.5 min-w-[190px] z-50 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl p-2 shadow-2xl shadow-indigo-500/10 animate-in fade-in-0 zoom-in-95">
              <div className="space-y-0.5 py-1">
                <Link
                  href="/settings"
                  onClick={() => {
                    setMobileUserMenuOpen(false)
                    setMobileOpen(false)
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Settings className="size-3.5 text-muted-foreground" />
                  <span>Account Settings</span>
                </Link>
                <Link
                  href="/settings?tab=Billing & Usage"
                  onClick={() => {
                    setMobileUserMenuOpen(false)
                    setMobileOpen(false)
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
                >
                  <CreditCard className="size-3.5 text-muted-foreground" />
                  <span>Billing & Plan</span>
                </Link>
              </div>

              <div className="h-px bg-border/60 my-1" />

              <button
                type="button"
                onClick={() => {
                  setMobileUserMenuOpen(false)
                  setMobileOpen(false)
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
      </aside>
    </div>
  )
}

