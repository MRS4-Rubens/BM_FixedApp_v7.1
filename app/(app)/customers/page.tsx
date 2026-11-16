import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { getPlanEntitlements } from '@/lib/subscriptions/entitlements';
import { listCustomers } from '@/lib/actions/customers/list-customers';
import { CustomersClient } from '@/components/app/customers/customers-client';
import { parseCustomerListParams, type RawSearchParams } from '@/lib/invoices/list-params';
import { buildListHref } from '@/lib/pagination/url';

export const metadata: Metadata = { title: 'Customers' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    redirect('/login');
  }

  if (!appUser.business_id) {
    redirect('/settings');
  }

  const rawParams = searchParams ? await searchParams : {};
  const params = parseCustomerListParams(rawParams);

  const result = await listCustomers({
    q: params.q ?? undefined,
    includeInactive: params.includeInactive,
    limit: params.size,
    after: params.after,
    before: params.before,
  });

  if (!result.success) {
    if (result.error.code === 'UNAUTHORIZED') {
      redirect('/login');
    }
    return <div className="p-4 text-destructive">Failed to load customers.</div>;
  }

  const page = result.data;
  const baseFilterParams = {
    q: params.q || undefined,
    inactive: params.includeInactive ? 'true' : undefined,
  };

  const previousHref =
    page.pageInfo.hasPreviousPage && page.pageInfo.startCursor
      ? buildListHref('/customers', { ...baseFilterParams, before: page.pageInfo.startCursor })
      : null;

  const nextHref =
    page.pageInfo.hasNextPage && page.pageInfo.endCursor
      ? buildListHref('/customers', { ...baseFilterParams, after: page.pageInfo.endCursor })
      : null;

  const business = await getCurrentBusiness();
  const canImport = business ? getPlanEntitlements(business).canImportData : false;

  return (
    <CustomersClient
      page={page}
      previousHref={previousHref}
      nextHref={nextHref}
      currentParams={params}
      canImport={canImport}
    />
  );
}
