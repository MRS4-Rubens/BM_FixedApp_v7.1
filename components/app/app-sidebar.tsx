'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTabletPortrait } from './app-sidebar/use-tablet-portrait'
import { DesktopSidebar } from './app-sidebar/desktop-sidebar'
import { MobileDrawer } from './app-sidebar/mobile-drawer'

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
  subscription?: {
    plan: string
    status: string
    endsAt: string | null
  } | null
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
  const userMenuRef = useRef<HTMLDivElement>(null)
  const mobileUserMenuRef = useRef<HTMLDivElement>(null)

  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setMobileOpen(false)
    setMobileUserMenuOpen(false)
  }

  const [daysRemaining] = useState<number | null>(() => {
    if (!subscription?.endsAt) return null
    const diff = new Date(subscription.endsAt).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  })

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
    await authClient.signOut()
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
        daysRemaining={daysRemaining}
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
        daysRemaining={daysRemaining}
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
