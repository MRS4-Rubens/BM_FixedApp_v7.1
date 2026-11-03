import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { JSX } from 'react';
import { z } from 'zod';
import { BoundaryThrower } from '@/app/(app)/dev-boundary-test/boundary-thrower';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const adminModeSchema = z.enum(['server', 'client']);

export default async function AdminDevBoundaryTestPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const raw = (await searchParams).mode;
  const parsed = adminModeSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const mode = parsed.success ? parsed.data : null;

  if (mode === 'server') throw new Error('FE-003 dev test: admin server component render error');
  if (mode === 'client') return <BoundaryThrower />;

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8">
      <div>
        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
          Development Only · Admin Scope
        </span>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Admin Route Boundary Test Harness</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a test mode below to verify the admin segment error boundary and retry flows.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/dev-boundary-test?mode=server"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full p-4 flex-col items-start gap-1 text-left')}
        >
          <span className="font-semibold text-foreground">Admin Server Render Error</span>
          <span className="text-xs text-muted-foreground">Throws inside admin Server Component</span>
        </Link>
        <Link
          href="/admin/dev-boundary-test?mode=client"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-full p-4 flex-col items-start gap-1 text-left')}
        >
          <span className="font-semibold text-foreground">Admin Client Render Error</span>
          <span className="text-xs text-muted-foreground">Throws inside admin Client Component</span>
        </Link>
      </div>
    </div>
  );
}

