import type { JSX } from 'react';
import { ReportsSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <ReportsSkeleton label="Loading reports" />;
}

