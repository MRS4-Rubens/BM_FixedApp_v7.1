import Link from 'next/link';
import type { JSX } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PaginationControlsProps {
  readonly shown: number;
  readonly total: number;
  readonly previousHref: string | null;
  readonly nextHref: string | null;
  readonly label: string;
}

/**
 * Presentational pagination controls for list screens.
 * Pure Server Component (no hooks) rendering server-generated Links.
 */
export function PaginationControls({
  shown,
  total,
  previousHref,
  nextHref,
  label,
}: PaginationControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4 text-xs text-muted-foreground">
      <p>
        Showing <span className="font-medium text-foreground">{shown}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> {label}
      </p>

      <div className="flex items-center gap-2">
        {previousHref ? (
          <Link
            href={previousHref}
            prefetch={false}
            aria-label="Previous page"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'h-9 text-[13px] sm:text-sm font-semibold gap-1',
            )}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'h-9 text-[13px] sm:text-sm font-semibold gap-1 pointer-events-none opacity-50',
            )}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </span>
        )}

        {nextHref ? (
          <Link
            href={nextHref}
            prefetch={false}
            aria-label="Next page"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'h-9 text-[13px] sm:text-sm font-semibold gap-1',
            )}
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'h-9 text-[13px] sm:text-sm font-semibold gap-1 pointer-events-none opacity-50',
            )}
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}

