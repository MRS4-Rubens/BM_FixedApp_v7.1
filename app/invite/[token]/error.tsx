'use client';

import type { JSX } from 'react';
import { RouteErrorView } from '@/components/app/route-error-view';

/**
 * BUG-06: the invite page reads the session and the database (a cold database can fail). Without this boundary a
 * failure fell through to the full-page global error; now it shows the friendly retry view.
 */
export default function InviteRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return <RouteErrorView error={error} reset={reset} scope="invite" />;
}
