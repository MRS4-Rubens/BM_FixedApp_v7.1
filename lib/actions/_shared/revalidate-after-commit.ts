import { revalidatePath } from 'next/cache';
import { logError } from '@/lib/actions/_shared/logger';

/**
 * BUG-05: refresh cached pages AFTER a transaction has committed, without ever turning that committed success into an
 * error. If revalidation throws, the user would otherwise see "something went wrong" for work that WAS saved (and, for
 * a payment, might record it again). A failure here is logged; the page refreshes on the next navigation anyway.
 */
export function revalidateAfterCommit(scope: string, paths: readonly string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error: unknown) {
      logError(scope, error, { step: 'revalidate-after-commit', path });
    }
  }
}
