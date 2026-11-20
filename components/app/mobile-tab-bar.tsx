'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, LayoutDashboard, Menu, Plus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Phone navigation (mobile plan step 1): a bottom tab bar under the scrolling page, shown below the md breakpoint
 * only. It sits in the page layout (not floating), so it never covers content. "More" opens the existing navigation
 * drawer through the same event the top-bar menu button uses. Accountants (read-only) get no "New" button.
 */

type TabKey = 'dashboard' | 'invoices' | 'new' | 'customers' | 'more'

/** Which tab a path belongs to; everything not listed is under "More" (products, reports, settings, ...). */
export function activeTabForPath(pathname: string): TabKey {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'dashboard'
  if (pathname === '/invoices/new') return 'new'
  if (pathname.startsWith('/invoices') || pathname.startsWith('/credit-notes')) return 'invoices'
  if (pathname.startsWith('/customers')) return 'customers'
  return 'more'
}

const TABS = [
  { tab: 'dashboard', label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { tab: 'invoices', label: 'Invoices', href: '/invoices', icon: FileText },
  { tab: 'customers', label: 'Customers', href: '/customers', icon: Users },
] as const

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof FileText; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
        active ? 'text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
          active ? 'bg-indigo-500/10' : 'group-hover:bg-muted',
        )}
      >
        <Icon className="size-[18px]" strokeWidth={active ? 2.25 : 1.9} aria-hidden="true" />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  )
}

export function MobileTabBar({ canCreate }: { canCreate: boolean }) {
  const pathname = usePathname()
  const active = activeTabForPath(pathname)
  const [home, invoices, customers] = TABS

  return (
    <nav
      aria-label="Main"
      className="relative z-30 shrink-0 border-t border-border/70 bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md shadow-[0_-6px_16px_-10px_rgba(79,70,229,0.18)] md:hidden print:hidden"
    >
      {/* Fixed 56px row; the safe-area inset (home bar) is padding on the nav around it, so controls keep full height. */}
      <div className="mx-auto flex h-14 max-w-md items-stretch gap-1 px-2">
        <TabLink href={home.href} label={home.label} icon={home.icon} active={active === home.tab} />
        <TabLink href={invoices.href} label={invoices.label} icon={invoices.icon} active={active === invoices.tab} />

        {canCreate && (
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <Link
              href="/invoices/new"
              aria-label="New invoice"
              aria-current={active === 'new' ? 'page' : undefined}
              className={cn(
                'flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30 transition-transform active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                active === 'new' && 'ring-2 ring-indigo-300 ring-offset-2 ring-offset-card',
              )}
            >
              <Plus className="size-5" strokeWidth={2.5} aria-hidden="true" />
            </Link>
          </div>
        )}

        <TabLink href={customers.href} label={customers.label} icon={customers.icon} active={active === customers.tab} />

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('bm:toggle-mobile-nav'))}
          className={cn(
            'group flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
            active === 'more' ? 'text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span
            className={cn(
              'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
              active === 'more' ? 'bg-indigo-500/10' : 'group-hover:bg-muted',
            )}
          >
            <Menu className="size-[18px]" strokeWidth={active === 'more' ? 2.25 : 1.9} aria-hidden="true" />
          </span>
          <span className="truncate">More</span>
        </button>
      </div>
    </nav>
  )
}
