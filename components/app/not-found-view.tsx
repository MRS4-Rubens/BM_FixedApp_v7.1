import Link from 'next/link';
import type { JSX } from 'react';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function NotFoundView(): JSX.Element {
  return (
    <section style={{ minHeight: '60vh' }} className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileQuestion className="size-6" aria-hidden="true" />
        </div>
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
          404 Error
        </span>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground font-heading">
          We couldn&apos;t find that page
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you requested does not exist or may have been moved. Check the URL or return to your workspace.
        </p>
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to home
          </Link>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: 'default' }))}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

