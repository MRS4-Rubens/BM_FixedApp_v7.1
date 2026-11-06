'use client';

import type { JSX } from 'react';
import { RouteErrorView } from '@/components/app/route-error-view';

export default function AdminRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return <RouteErrorView error={error} reset={reset} scope="admin" />;
}

