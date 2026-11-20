import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { AppSidebar } from '@/components/app/app-sidebar'
import { MobileTabBar } from '@/components/app/mobile-tab-bar'
import { AppTopbar } from '@/components/app/app-topbar'
import { getCurrentAppUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/auth/admin'
import { getCurrentBusiness } from '@/lib/auth/current-business'
import { buildLogoUrl } from '@/lib/storage/logo-url'
import { canEditBusinessData, isAppRole } from '@/lib/auth/rbac'
import { CurrentUserRoleProvider } from '@/components/app/current-user-role'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [user, isAdminUser] = await Promise.all([getCurrentAppUser(), isPlatformAdmin()])

  const cookieStore = await cookies()
  const cookieVal = cookieStore.get('sidebar:collapsed')?.value
  const collapsedPreference = cookieVal === 'true' ? true : cookieVal === 'false' ? false : null

  const userProp = user ? {
    name: user.display_name || 'User',
    role: user.role,
    initials: (user.display_name || 'U').substring(0, 2).toUpperCase()
  } : undefined

  let subscriptionProp: {
    plan: string;
    status: string;
    endsAt: string | null;
  } | null = null

  let businessLogoUrl: string | undefined = undefined

  const business = user?.business_id ? await getCurrentBusiness() : null

  if (business && user?.business_id) {
    subscriptionProp = {
      plan: business.subscription_plan,
      status: business.subscription_status,
      endsAt: business.subscription_ends_at
        ? business.subscription_ends_at.toISOString()
        : (business.trial_ends_at ? business.trial_ends_at.toISOString() : null),
    }

    if (business.logo_storage_key) {
      businessLogoUrl = buildLogoUrl(user.business_id, business.logo_storage_key)
    }
  }

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-background print:overflow-visible print:h-auto">
      <div className="print:hidden">
        <AppSidebar
          user={userProp}
          collapsedPreference={collapsedPreference}
          isAdminUser={isAdminUser}
          subscription={subscriptionProp}
          businessLogoUrl={businessLogoUrl}
        />
      </div>
      <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden print:overflow-visible">
        <div className="relative z-40 shrink-0 print:hidden">
          <AppTopbar notificationsEnabled={Boolean(user?.business_id)} />
        </div>
        <main data-app-scroll-region className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain touch-momentum px-3 pt-4 sm:pt-2.5 sm:px-6 lg:pt-3 lg:px-8 pb-6 md:pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:pb-[max(2rem,env(safe-area-inset-bottom))] print:overflow-visible print:p-0">
          <CurrentUserRoleProvider role={user && isAppRole(user.role) ? user.role : 'owner'}>
            {children}
          </CurrentUserRoleProvider>
        </main>
        {/* Phones: bottom tab bar under the scrolling page (it carries the safe-area inset itself). */}
        <MobileTabBar canCreate={Boolean(user?.business_id && isAppRole(user.role) && canEditBusinessData(user.role))} />
      </div>
    </div>
  )
}
