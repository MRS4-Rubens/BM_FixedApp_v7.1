import { cookies } from 'next/headers'
import { AppSidebar } from '@/components/app/app-sidebar'
import { AppTopbar } from '@/components/app/app-topbar'
import { getCurrentAppUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/auth/admin'

import { db } from '@/lib/db/client'
import { businesses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { buildLogoUrl } from '@/lib/storage/logo-url'

export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentAppUser()
  const isAdminUser = await isPlatformAdmin()

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

  if (user?.business_id) {
    const biz = await db
      .select({
        plan: businesses.subscription_plan,
        status: businesses.subscription_status,
        endsAt: businesses.subscription_ends_at,
        trialEndsAt: businesses.trial_ends_at,
        logoStorageKey: businesses.logo_storage_key,
      })
      .from(businesses)
      .where(eq(businesses.id, user.business_id))
      .limit(1)

    if (biz[0]) {
      subscriptionProp = {
        plan: biz[0].plan,
        status: biz[0].status,
        endsAt: biz[0].endsAt ? biz[0].endsAt.toISOString() : (biz[0].trialEndsAt ? biz[0].trialEndsAt.toISOString() : null),
      }

      if (biz[0].logoStorageKey) {
        businessLogoUrl = buildLogoUrl(user.business_id, biz[0].logoStorageKey)
      }
    }
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-background print:overflow-visible print:h-auto">
      <div className="print:hidden">
        <AppSidebar
          user={userProp}
          collapsedPreference={collapsedPreference}
          isAdminUser={isAdminUser}
          subscription={subscriptionProp}
          businessLogoUrl={businessLogoUrl}
        />
      </div>
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden print:overflow-visible">
        <div className="relative z-40 print:hidden">
          <AppTopbar />
        </div>
        <main className="flex-1 overflow-y-auto touch-momentum px-3 py-4 sm:pt-2.5 sm:pb-6 sm:px-6 lg:pt-3 lg:pb-8 lg:px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  )
}
