import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app/app-sidebar';
import { AppTopbar } from '@/components/app/app-topbar';
import { getPlatformAdminDecision } from '@/lib/auth/admin';
import { getCurrentAppUser } from '@/lib/auth/session';

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
  const defaultCollapsed = cookieStore.get('sidebar:collapsed')?.value === 'true';

  const userProp = user
    ? {
        name: user.display_name || 'Admin',
        role: 'Platform Admin',
        initials: (user.display_name || 'A').substring(0, 2).toUpperCase(),
      }
    : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background print:overflow-visible print:h-auto">
      <div className="print:hidden">
        {/* Pass down the user profile with the Platform Admin role override */}
        <AppSidebar user={userProp} defaultCollapsed={defaultCollapsed} isAdminUser={true} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <AppTopbar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 bg-muted/20">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
