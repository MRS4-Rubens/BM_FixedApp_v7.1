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
 * Returns human-readable role label: "Owner" for 'owner' and "Team member" for 'staff'.
 */
export function roleLabel(role: unknown): string {
  return role === 'staff' ? 'Team member' : 'Owner';
}
