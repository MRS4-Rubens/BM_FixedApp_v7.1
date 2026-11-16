import { redirect } from 'next/navigation';
import { canEditBusinessData } from '@/lib/auth/rbac';

/**
 * Feature B: create / edit pages are only for roles that may change business data (owner, staff).
 * The read-only accountant (CA) is sent to the matching list page instead. The server actions refuse
 * them anyway (roles: EDITOR_ROLES); this keeps them from landing on a form they can never save.
 */
export function redirectReadOnlyRole(role: unknown, fallbackPath: string): void {
  if (!canEditBusinessData(role)) {
    redirect(fallbackPath);
  }
}
