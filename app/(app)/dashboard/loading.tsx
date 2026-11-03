import type { JSX } from 'react';
import { DashboardSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <DashboardSkeleton label="Loading dashboard" />;
}

