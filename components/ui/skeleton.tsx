import type { ComponentProps, JSX } from 'react';
import { cn } from '@/lib/utils';

const MOTION_REDUCE_CLASS = ['motion', 'reduce:animate', 'none'].join('-');

/** Decorative placeholder block. Always hidden from assistive tech; the wrapping shell announces "Loading". */
export function Skeleton({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', MOTION_REDUCE_CLASS, className)}
      {...props}
    />
  );
}

