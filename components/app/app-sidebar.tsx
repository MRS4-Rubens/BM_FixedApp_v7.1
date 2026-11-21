'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTabletPortrait } from './app-sidebar/use-tablet-portrait'
import { DesktopSidebar } from './app-sidebar/desktop-sidebar'
import { MobileDrawer } from './app-sidebar/mobile-drawer'
import type { SidebarSubscription } from './app-sidebar/account-plan'
import { clearAllUnsavedInvoiceDrafts } from './invoices/invoice-form/use-unsaved-invoice-draft'
import { usePageScrollLock } from '@/lib/hooks/use-page-scroll-lock'

export function AppSidebar({
  user,
  collapsedPreference = null,
  isAdminUser = false,
  subscription,
  businessLogoUrl,
}: {
  user?: { name: string; role: string; initials: string }
  collapsedPreference?: boolean | null
  isAdminUser?: boolean
  subscription?: SidebarSubscription | null
  businessLogoUrl?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(collapsedPreference)
  const isTabletPortrait = useTabletPortrait()
  const isCollapsed = userCollapsed ?? isTabletPortrait

  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false)
  usePageScrollLock(mobileOpen)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const mobileUserMenuRef = useRef<HTMLDivElement>(null)

  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setMobileOpen(false)
    setMobileUserMenuOpen(false)
  }


  // Listen for custom topbar mobile navigation toggle event
  useEffect(() => {
    const handleToggleMobileNav = () => {
      setMobileOpen((prev) => !prev)
    }
    window.addEventListener('bm:toggle-mobile-nav', handleToggleMobileNav)
    return () => {
      window.removeEventListener('bm:toggle-mobile-nav', handleToggleMobileNav)
    }
  }, [])

  // A drawer hidden by the desktop breakpoint must not retain its background scroll lock.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeMobileDrawer = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    desktop.addEventListener('change', closeMobileDrawer)
    return () => desktop.removeEventListener('change', closeMobileDrawer)
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
      if (mobileUserMenuRef.current && !mobileUserMenuRef.current.contains(event.target as Node)) {
        setMobileUserMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
        setMobileUserMenuOpen(false)
        setMobileOpen(false)
      }
    }
    if (userMenuOpen || mobileUserMenuOpen || mobileOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [userMenuOpen, mobileUserMenuOpen, mobileOpen])

  async function handleSignOut() {
    const { authClient } = await import('@/lib/auth/client')
    const result = await authClient.signOut()
    // Forget unsaved invoice copies only once the session is really gone (a failed sign-out keeps them).
    if (!result?.error) clearAllUnsavedInvoiceDrafts()
    router.push('/login')
    router.refresh()
  }

  const handleToggle = () => {
    const nextCollapsed = !isCollapsed
    setUserCollapsed(nextCollapsed)
    document.cookie = `sidebar:collapsed=${nextCollapsed}; path=/; max-age=31536000`
  }

  return (
    <TooltipProvider>
      <DesktopSidebar
        pathname={pathname}
        isCollapsed={isCollapsed}
        handleToggle={handleToggle}
        isAdminUser={isAdminUser}
        subscription={subscription}
        user={user}
        businessLogoUrl={businessLogoUrl}
        userMenuOpen={userMenuOpen}
        setUserMenuOpen={setUserMenuOpen}
        userMenuRef={userMenuRef}
        onSignOut={handleSignOut}
      />
      <MobileDrawer
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        pathname={pathname}
        isAdminUser={isAdminUser}
        subscription={subscription}
        user={user}
        businessLogoUrl={businessLogoUrl}
        mobileUserMenuOpen={mobileUserMenuOpen}
        setMobileUserMenuOpen={setMobileUserMenuOpen}
        mobileUserMenuRef={mobileUserMenuRef}
        onSignOut={handleSignOut}
      />
    </TooltipProvider>
  )
}
