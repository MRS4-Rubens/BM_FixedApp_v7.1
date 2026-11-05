import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { listProducts } from '@/lib/actions/products/list-products';
import { ProductsClient } from '@/components/app/products/products-client';
import { parseProductListParams, type RawSearchParams } from '@/lib/invoices/list-params';
import { buildListHref } from '@/lib/pagination/url';

export default async function ProductsPage({
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
  const params = parseProductListParams(rawParams);

  const result = await listProducts({
    q: params.q ?? undefined,
    includeInactive: params.includeInactive,
    kind: params.kind,
    limit: params.size,
    after: params.after,
    before: params.before,
  });

  if (!result.success) {
    if (result.error.code === 'UNAUTHORIZED') {
      redirect('/login');
    }
    throw new Error(result.error.message || 'Failed to fetch products');
  }

  const page = result.data;
  const baseFilterParams = {
    q: params.q || undefined,
    inactive: params.includeInactive ? 'true' : undefined,
    kind: params.kind !== 'all' ? params.kind : undefined,
  };

  const previousHref =
    page.pageInfo.hasPreviousPage && page.pageInfo.startCursor
      ? buildListHref('/products', { ...baseFilterParams, before: page.pageInfo.startCursor })
      : null;

  const nextHref =
    page.pageInfo.hasNextPage && page.pageInfo.endCursor
      ? buildListHref('/products', { ...baseFilterParams, after: page.pageInfo.endCursor })
      : null;

  return (
    <ProductsClient
      page={page}
      previousHref={previousHref}
      nextHref={nextHref}
      currentParams={params}
    />
  );
}
