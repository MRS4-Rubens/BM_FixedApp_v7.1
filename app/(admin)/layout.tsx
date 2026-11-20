import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app/app-sidebar';
import { AppTopbar } from '@/components/app/app-topbar';
import { getPlatformAdminDecision } from '@/lib/auth/admin';
import { getCurrentAppUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const decision = await getPlatformAdminDecision();
  if (!decision.allowed) {
    redirect(decision.reason === 'no_session' ? '/login' : '/dashboard');
  }

  // Fetch app user profile details for sidebar initialization
  const user = await getCurrentAppUser();
  const cookieStore = await cookies();
  const cookieVal = cookieStore.get('sidebar:collapsed')?.value;
  const collapsedPreference = cookieVal === 'true' ? true : cookieVal === 'false' ? false : null;

  const userProp = user
    ? {
        name: user.display_name || 'Admin',
        role: 'Platform Admin',
        initials: (user.display_name || 'A').substring(0, 2).toUpperCase(),
      }
    : undefined;

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-[100dvh] min-h-0 overflow-hidden bg-background print:overflow-visible print:h-auto">
      <div className="print:hidden">
        {/* Pass down the user profile with the Platform Admin role override */}
        <AppSidebar user={userProp} collapsedPreference={collapsedPreference} isAdminUser={true} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        <AppTopbar />
        <main data-app-scroll-region className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain p-4 md:p-6 lg:p-8 bg-muted/20 print:overflow-visible print:p-0">
          <div data-desktop-canvas data-admin-canvas>
            <div className="max-w-7xl mx-auto">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
