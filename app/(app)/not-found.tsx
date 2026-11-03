import type { Metadata } from 'next';
import type { JSX } from 'react';
import { NotFoundView } from '@/components/app/not-found-view';

export const metadata: Metadata = { title: 'Not found' };

export default function AppNotFound(): JSX.Element {
  return <NotFoundView />;
}

