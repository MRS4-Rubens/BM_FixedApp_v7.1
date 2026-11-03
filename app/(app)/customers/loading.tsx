import type { JSX } from 'react';
import { ListPageSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <ListPageSkeleton label="Loading customers" />;
}

