import type { Metadata } from 'next';

import { AdminConsole } from './admin-console';
import { getAdminDashboardStats } from '@/lib/actions/subscriptions/get-admin-dashboard-stats';
import { getPendingRequests } from '@/lib/actions/subscriptions/get-pending-requests';
import { getAllBusinesses } from '@/lib/actions/subscriptions/get-all-businesses';
import { getAllUsers } from '@/lib/actions/subscriptions/get-all-users';
import { loadPayeeConfig, describePayeeProblems } from '@/lib/config/payee';

export const metadata: Metadata = {
  title: 'Platform Admin Console',
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  // 1. Trigger Server Actions in parallel
  const [statsRes, pendingRes, businessesRes, usersRes] = await Promise.all([
    getAdminDashboardStats({}),
    getPendingRequests({}),
    getAllBusinesses({}),
    getAllUsers({}),
  ]);

  // 2. Error handling if any action fails
  if (!statsRes.success || !pendingRes.success || !businessesRes.success || !usersRes.success) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-rose-700 dark:text-rose-400">
          <h2 className="text-lg font-bold">Failed to load administrative console</h2>
          <p className="mt-2 text-sm leading-relaxed">
            You do not have access to this page.
          </p>
        </div>
      </div>
    );
  }

  const stats = statsRes.data;
  const pendingRaw = pendingRes.data;
  const businessesRaw = businessesRes.data;
  const usersRaw = usersRes.data;

  // 3. Serialize pending requests date columns to ISO strings
  const pendingRequests = pendingRaw.map((req) => ({
    ...req,
    createdAt: req.createdAt.toISOString(),
  }));

  // 4. Serialize date columns to ISO strings
  const businessesProp = businessesRaw.map((b) => ({
    ...b,
    subscriptionEndsAt: b.subscriptionEndsAt ? b.subscriptionEndsAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  }));

  const usersProp = usersRaw.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  }));

  // 5. Resolve payee details. FAIL CLOSED: never fabricate values; the console shows a notice instead.
  const payee = loadPayeeConfig();
  const upiConfig = payee.status === 'configured' ? payee.config : null;
  const payeeConfigIssue =
    payee.status === 'unavailable' ? describePayeeProblems(payee.problems) : null;
  if (payeeConfigIssue !== null) {
    console.error(`[admin] Payee configuration problems: ${payeeConfigIssue}`);
  }

  return (
    <div className="w-full pb-12">
      <AdminConsole
        stats={stats}
        pendingRequests={pendingRequests}
        businesses={businessesProp}
        users={usersProp}
        upiConfig={upiConfig}
        payeeConfigIssue={payeeConfigIssue}
      />
    </div>
  );
}
