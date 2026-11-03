import type { JSX } from 'react';
import { FormPageSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <FormPageSkeleton label="Loading credit note form" />;
}

