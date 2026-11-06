import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { JSX } from 'react';
import { z } from 'zod';
import { BoundaryThrower } from './boundary-thrower';
import { SkeletonGallery } from './skeleton-gallery';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const modeSchema = z.enum(['server', 'client', 'slow', 'skeletons']);

export default async function DevBoundaryTestPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const raw = (await searchParams).mode;
  const parsed = modeSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const mode = parsed.success ? parsed.data : null;

  if (mode === 'server') throw new Error('FE-003 dev test: server component render error');
  if (mode === 'client') return <BoundaryThrower />;
  if (mode === 'slow') await new Promise<void>((resolve) => setTimeout(resolve, 3000));
  if (mode === 'skeletons') return <SkeletonGallery />;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
          Development Only
        </span>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Route Boundary Test Harness</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a test mode below to verify error boundaries, suspense loading skeletons, and retry flows.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/dev-boundary-test?mode=server"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full flex-col items-start gap-1 p-4 text-left')}
        >
          <span className="font-semibold text-foreground">Server Render Error</span>
          <span className="text-xs text-muted-foreground">Throws inside Server Component during RSC rendering</span>
        </Link>
        <Link
          href="/dev-boundary-test?mode=client"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full flex-col items-start gap-1 p-4 text-left')}
        >
          <span className="font-semibold text-foreground">Client Render Error</span>
          <span className="text-xs text-muted-foreground">Throws inside Client Component during hydration</span>
        </Link>
        <Link
          href="/dev-boundary-test?mode=slow"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full flex-col items-start gap-1 p-4 text-left')}
        >
          <span className="font-semibold text-foreground">Slow Navigation (3s delay)</span>
          <span className="text-xs text-muted-foreground">Triggers Suspense boundary with loading skeleton</span>
        </Link>
        <Link
          href="/dev-boundary-test?mode=skeletons"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full flex-col items-start gap-1 p-4 text-left')}
        >
          <span className="font-semibold text-foreground">Skeleton Gallery</span>
          <span className="text-xs text-muted-foreground">Preview all 6 deterministic page skeletons</span>
        </Link>
      </div>
    </div>
  );
}

