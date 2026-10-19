'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Bell, HelpCircle, MessageSquare, ExternalLink, Mail, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

const getPageTitleAndPlaceholder = (pathname: string): { title: string; placeholder: string } => {
  if (pathname === '/dashboard') {
    return { title: 'Dashboard', placeholder: 'Search Dashboard' }
  }
  if (pathname === '/invoices') {
    return { title: 'Invoices', placeholder: 'Search Invoices' }
  }
  if (pathname === '/invoices/new') {
    return { title: 'New Invoice', placeholder: 'Search Invoices' }
  }
  if (pathname.includes('/credit-note')) {
    return { title: 'Issue Credit Note', placeholder: 'Search Invoices' }
  }
  if (pathname.startsWith('/credit-notes/')) {
    return { title: 'Credit Note Details', placeholder: 'Search Credit Notes' }
  }
  if (pathname === '/credit-notes') {
    return { title: 'Credit Notes', placeholder: 'Search Credit Notes' }
  }
  if (pathname.startsWith('/invoices/')) {
    return { title: 'Invoice Details', placeholder: 'Search Invoices' }
  }
  if (pathname === '/customers') {
    return { title: 'Customers', placeholder: 'Search Customers' }
  }
  if (pathname === '/customers/new') {
    return { title: 'Add Customer', placeholder: 'Search Customers' }
  }
  if (pathname.startsWith('/customers/')) {
    return { title: 'Customer Details', placeholder: 'Search Customers' }
  }
  if (pathname === '/products') {
    return { title: 'Products', placeholder: 'Search Products & Services' }
  }
  if (pathname === '/products/new') {
    return { title: 'Add Product', placeholder: 'Search Products & Services' }
  }
  if (pathname.startsWith('/products/')) {
    return { title: 'Product Details', placeholder: 'Search Products & Services' }
  }
  if (pathname === '/reports') {
    return { title: 'Reports', placeholder: 'Search Reports' }
  }
  if (pathname === '/settings') {
    return { title: 'Settings', placeholder: 'Search Settings' }
  }
  if (pathname.startsWith('/admin')) {
    return { title: 'Admin Console', placeholder: 'Search platform records, businesses, UTRs...' }
  }
  return { title: 'Bill Matrix', placeholder: 'Search...' }
}

export function AppTopbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { title, placeholder } = getPageTitleAndPlaceholder(pathname)

  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setHelpOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHelpOpen(false)
      }
    }
    if (helpOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [helpOpen])

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (q) {
      router.push(`/invoices?search=${encodeURIComponent(q)}`)
    } else {
      router.push('/invoices')
    }
  }

  return (
    <header className="relative z-40 flex h-14 landscape:max-md:h-11 shrink-0 items-center gap-2 sm:gap-4 border-b border-border/70 bg-card/90 backdrop-blur-md px-3 sm:px-6 shadow-[0_1px_3px_rgba(99,102,241,0.03),0_8px_16px_-8px_rgba(99,102,241,0.08)] print:hidden">
      {/* Mobile Hamburger Button (< 768px) */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('bm:toggle-mobile-nav'))}
        className="inline-flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors md:hidden cursor-pointer"
        aria-label="Open navigation menu"
      >
        <Menu className="size-4.5 sm:size-5" />
      </button>

      {/* Page title */}
      <span className="flex-1 min-w-0 truncate text-sm sm:text-base lg:text-lg font-extrabold text-foreground font-heading tracking-wide uppercase">
        {title}
      </span>

      {/* Right controls */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Search */}
        <form
          onSubmit={handleSearchSubmit}
          className="hidden sm:flex w-48 lg:w-72 items-center justify-between rounded-xl border border-border/50 bg-background/60 hover:bg-accent/80 focus-within:bg-background focus-within:border-indigo-500/40 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all duration-200 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm"
        >
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <Search className="size-3.5 shrink-0 text-muted-foreground/80" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="w-full bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none truncate"
            />
          </div>
          <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground/70 border border-border/30 shrink-0 ml-2">
            ⌘K
          </kbd>
        </form>

        {/* Bell notification button */}
        <button
          type="button"
          aria-label="Notifications"
          title="No unread notifications"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-indigo-500/10 hover:text-indigo-600 transition-all duration-200 border border-transparent hover:border-indigo-500/20 relative cursor-pointer"
        >
          <Bell className="size-4" />
        </button>

        {/* Interactive Help Pill & Popover Menu */}
        <div className="relative" ref={helpRef}>
          <button
            type="button"
            onClick={() => setHelpOpen((prev) => !prev)}
            aria-expanded={helpOpen}
            aria-label="Help and feedback options"
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 hover:bg-indigo-500/10 hover:text-indigo-600 hover:border-indigo-500/20 transition-all duration-200 px-3 py-1 text-xs font-bold text-muted-foreground shadow-sm cursor-pointer select-none',
              helpOpen && 'bg-accent/90 border-indigo-500/30 text-indigo-600 ring-2 ring-indigo-500/15'
            )}
          >
            <HelpCircle className="size-3.5 shrink-0" />
            <span>HELP</span>
          </button>

          {helpOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-72 z-50 rounded-2xl border border-border/70 bg-card p-2.5 shadow-2xl shadow-slate-900/15 dark:shadow-black/50 transition-all duration-150 animate-in fade-in-0 zoom-in-95 max-w-[calc(100vw-2rem)] select-none"
            >
              {/* Popover Header Card (Identical to Sidebar Profile Popover) */}
              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-muted/40 mb-1.5 border border-border/40">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 text-white font-bold shadow-xs">
                  <HelpCircle className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">
                    Support &amp; Assistance
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Direct Developer Link
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Rows */}
              <div className="space-y-1">
                {/* 1. Help & Feedback Row (Opens dedicated feedback page in New Tab) */}
                <a
                  href="/settings?tab=User Feedback"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setHelpOpen(false)}
                  className="flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-foreground/90 hover:text-foreground hover:bg-accent/80 transition-all group cursor-pointer border border-transparent hover:border-border/60"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform mt-0.5">
                    <MessageSquare className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">Help &amp; Feedback</span>
                      <ExternalLink className="size-3 text-muted-foreground group-hover:text-indigo-600 transition-colors" />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                      Report bugs, request features, or propose UI/UX ideas in a new tab
                    </p>
                  </div>
                </a>

                {/* 2. Direct Email Inquiries */}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=Support%20Request%20-%20Bill%20Matrix`}
                  onClick={() => setHelpOpen(false)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-foreground/80 hover:text-foreground hover:bg-accent/80 transition-all group cursor-pointer border border-transparent hover:border-border/60"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-indigo-600 transition-colors">
                    <Mail className="size-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-foreground block">Email Support Directly</span>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {SUPPORT_EMAIL}
                    </p>
                  </div>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

