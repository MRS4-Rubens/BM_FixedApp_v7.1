'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { type AppRole, isOwnerRole } from '@/lib/auth/rbac';

const CurrentUserRoleContext = createContext<AppRole>('owner');

export interface CurrentUserRoleProviderProps {
  role: AppRole;
  children?: ReactNode;
}

export function CurrentUserRoleProvider({ role, children }: CurrentUserRoleProviderProps) {
  return (
    <CurrentUserRoleContext.Provider value={role}>
      {children}
    </CurrentUserRoleContext.Provider>
  );
}

export function useCurrentUserRole(): AppRole {
  return useContext(CurrentUserRoleContext);
}

export function useIsOwner(): boolean {
  const role = useCurrentUserRole();
  return isOwnerRole(role);
}

/**
 * Human-readable role label: "Owner", "Team member" (staff) or "Accountant (read-only)".
 */
export function roleLabel(role: unknown): string {
  if (role === 'staff') return 'Team member';
  if (role === 'accountant') return 'Accountant (read-only)';
  return 'Owner';
}
