import type { Metadata } from 'next';
import type { JSX } from 'react';
import { NotFoundView } from '@/components/app/not-found-view';

export const metadata: Metadata = { title: 'Page not found' };

export default function RootNotFound(): JSX.Element {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <NotFoundView />
    </main>
  );
}

