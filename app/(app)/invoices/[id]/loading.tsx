import type { JSX } from 'react';
import { DetailPageSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <DetailPageSkeleton label="Loading invoice" />;
}

