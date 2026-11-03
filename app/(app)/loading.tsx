import type { JSX } from 'react';
import { GenericPageSkeleton } from '@/components/app/skeletons/page-skeletons';

export default function Loading(): JSX.Element {
  return <GenericPageSkeleton label="Loading" />;
}

