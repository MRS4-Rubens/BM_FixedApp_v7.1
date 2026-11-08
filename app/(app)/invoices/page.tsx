import { redirect } from 'next/navigation';
import { listInvoices } from '@/lib/actions/invoices/list-invoices';
import { listCreditNotes } from '@/lib/actions/credit-notes/list-credit-notes';
import { InvoicesClient } from './client';
import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { parseInvoiceListParams, type RawSearchParams } from '@/lib/invoices/list-params';
import { buildListHref } from '@/lib/pagination/url';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  const appUser = await getCurrentAppUser();
  if (!appUser?.business_id) {
    redirect('/settings');
  }

  const rawParams = searchParams ? await searchParams : {};
  const params = parseInvoiceListParams(rawParams);

  const business = await getCurrentBusiness();
  const businessStateCode = business?.state_code || '';

  const isActiveInvoices = params.tab === 'invoices';

  const [invoicesResult, cnResult] = await Promise.all([
    listInvoices(
      isActiveInvoices
        ? {
            q: params.q ?? undefined,
            month: params.month,
            year: params.year,
            status: params.status,
            limit: params.size,
            after: params.after,
            before: params.before,
          }
        : {
            month: params.month,
            year: params.year,
            limit: 10,
          }
    ),
    listCreditNotes(
      !isActiveInvoices
        ? {
            q: params.q ?? undefined,
            month: params.month,
            year: params.year,
            limit: params.size,
            after: params.after,
            before: params.before,
          }
        : {
            month: params.month,
            year: params.year,
            limit: 10,
          }
    ),
  ]);

  if (!invoicesResult.success) {
    if (invoicesResult.error.code === 'UNAUTHORIZED') {
      redirect('/login');
    }
    return <div className="p-4 text-destructive">Failed to load invoices.</div>;
  }

  if (!cnResult.success) {
    if (cnResult.error.code === 'UNAUTHORIZED') {
      redirect('/login');
    }
    return <div className="p-4 text-destructive">Failed to load credit notes.</div>;
  }

  const activePageInfo = isActiveInvoices
    ? invoicesResult.data.pageInfo
    : cnResult.data.pageInfo;

  const baseFilterParams = {
    tab: params.tab,
    q: params.q || undefined,
    status: isActiveInvoices && params.status !== 'all' ? params.status : undefined,
    month: params.month,
    year: params.year,
  };

  const previousHref =
    activePageInfo.hasPreviousPage && activePageInfo.startCursor
      ? buildListHref('/invoices', { ...baseFilterParams, before: activePageInfo.startCursor })
      : null;

  const nextHref =
    activePageInfo.hasNextPage && activePageInfo.endCursor
      ? buildListHref('/invoices', { ...baseFilterParams, after: activePageInfo.endCursor })
      : null;

  return (
    <InvoicesClient
      invoicesPage={invoicesResult.data}
      creditNotesPage={cnResult.data}
      businessStateCode={businessStateCode}
      activeTab={params.tab}
      previousHref={previousHref}
      nextHref={nextHref}
      currentParams={params}
    />
  );
}
