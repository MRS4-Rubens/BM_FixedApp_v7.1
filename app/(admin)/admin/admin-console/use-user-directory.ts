'use client';

import { useState, useMemo } from 'react';
import type { UserItem } from './types';
import { ROWS_PER_PAGE } from './pagination';

export function useUserDirectory(users: UserItem[]) {
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'owner' | 'staff'>('all');
  const [userPage, setUserPage] = useState(1);

  const roleFilterOptions = useMemo(
    () => (users.some((u) => u.role === 'staff') ? (['all', 'owner', 'staff'] as const) : (['all', 'owner'] as const)),
    [users],
  );
  const effectiveRoleFilter = roleFilterOptions.some((option) => option === userRoleFilter) ? userRoleFilter : 'all';

  const changeUserSearch = (value: string) => {
    setUserSearch(value);
    setUserPage(1);
  };

  const changeUserRoleFilter = (role: 'all' | 'owner' | 'staff') => {
    setUserRoleFilter(role);
    setUserPage(1);
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        (u.displayName && u.displayName.toLowerCase().includes(userSearch.toLowerCase())) ||
        (u.businessName && u.businessName.toLowerCase().includes(userSearch.toLowerCase()));
      const matchRole = effectiveRoleFilter === 'all' ? true : u.role === effectiveRoleFilter;
      return matchSearch && matchRole;
    });
  }, [users, userSearch, effectiveRoleFilter]);

  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / ROWS_PER_PAGE));
  const safeUserPage = Math.min(Math.max(1, userPage), totalUserPages);
  const paginatedUsers = useMemo(() => {
    const start = (safeUserPage - 1) * ROWS_PER_PAGE;
    return filteredUsers.slice(start, start + ROWS_PER_PAGE);
  }, [filteredUsers, safeUserPage]);

  return {
    userSearch,
    userRoleFilter,
    userPage,
    setUserPage,
    roleFilterOptions,
    effectiveRoleFilter,
    changeUserSearch,
    changeUserRoleFilter,
    filteredUsers,
    totalUserPages,
    safeUserPage,
    paginatedUsers,
  };
}

