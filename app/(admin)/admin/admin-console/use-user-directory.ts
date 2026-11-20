'use client';

import { useState, useMemo } from 'react';
import type { UserItem } from './types';
import { ROWS_PER_PAGE } from './pagination';

export type UserRoleFilter = 'all' | 'owner' | 'staff' | 'accountant';

export function useUserDirectory(users: UserItem[]) {
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('all');
  const [userPage, setUserPage] = useState(1);

  const roleFilterOptions = useMemo(() => {
    const options: UserRoleFilter[] = ['all', 'owner'];
    if (users.some((u) => u.role === 'staff')) {
      options.push('staff');
    }
    if (users.some((u) => u.role === 'accountant')) {
      options.push('accountant');
    }
    return options;
  }, [users]);
  const effectiveRoleFilter = roleFilterOptions.some((option) => option === userRoleFilter) ? userRoleFilter : 'all';

  const changeUserSearch = (value: string) => {
    setUserSearch(value);
    setUserPage(1);
  };

  const changeUserRoleFilter = (role: UserRoleFilter) => {
    setUserRoleFilter(role);
    setUserPage(1);
  };

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      const matchSearch =
        query === '' ||
        [u.displayName, u.email, u.businessName].some((value) => value?.toLowerCase().includes(query));
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

