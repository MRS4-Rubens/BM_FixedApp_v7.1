'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition, type JSX } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type RouteErrorScope = 'app' | 'admin' | 'invite';

export interface RouteErrorViewProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
  readonly scope: RouteErrorScope;
}

const HOME_LINK: Record<RouteErrorScope, { href: string; label: string }> = {
  app: { href: '/dashboard', label: 'Go to dashboard' },
  admin: { href: '/admin', label: 'Back to admin home' },
  // BUG-06: the invite page is opened by people who may not have an account yet.
  invite: { href: '/', label: 'Go to home page' },
};

export function RouteErrorView({ error, reset, scope }: RouteErrorViewProps): JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    Sentry.captureException(error, {
      tags: { error_boundary: scope, ...(error.digest ? { digest: error.digest } : {}) },
    });
  }, [error, scope]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleRetry = (): void => {
    // Server Component errors need a server refetch; reset() alone only re-renders the client boundary.
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  const home = HOME_LINK[scope];

  return (
    <section role="alert" style={{ minHeight: '60vh' }} className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </div>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          This page couldn&apos;t be loaded
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our side and we&apos;ve been notified.
          {scope === 'invite'
            ? ' Your invitation is still valid. Please try again in a moment.'
            : ' The rest of the app is still working. If you were saving or finalizing a document, open its list first to check whether it went through before trying again.'}
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Link href={home.href} className={cn(buttonVariants({ variant: 'outline' }))}>
            {home.label}
          </Link>
          <Button type="button" onClick={handleRetry} disabled={isPending} aria-busy={isPending}>
            {isPending ? 'Retrying…' : 'Try again'}
          </Button>
        </div>
      </div>
    </section>
  );
}

