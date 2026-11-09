'use client';

import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { getVisiblePageNumbers, ROWS_PER_PAGE } from './pagination';
import type { UserItem } from './types';

interface UsersTabProps {
  totalUsersCount: number;
  filteredUsers: UserItem[];
  paginatedUsers: UserItem[];
  userSearch: string;
  roleFilterOptions: readonly ('all' | 'owner' | 'staff')[];
  effectiveRoleFilter: 'all' | 'owner' | 'staff';
  totalUserPages: number;
  safeUserPage: number;
  onChangeUserSearch: (value: string) => void;
  onChangeUserRoleFilter: (role: 'all' | 'owner' | 'staff') => void;
  onSetUserPage: (page: number | ((p: number) => number)) => void;
}

export function UsersTab({
  totalUsersCount,
  filteredUsers,
  paginatedUsers,
  userSearch,
  roleFilterOptions,
  effectiveRoleFilter,
  totalUserPages,
  safeUserPage,
  onChangeUserSearch,
  onChangeUserRoleFilter,
  onSetUserPage,
}: UsersTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground font-heading">
            Platform Users Directory ({filteredUsers.length} of {totalUsersCount})
          </h3>
          <p className="text-xs font-semibold text-muted-foreground">
            All authenticated accounts and tenancy memberships.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card p-3 rounded-xl border border-border shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users by name or business affiliation..."
            value={userSearch}
            onChange={(e) => onChangeUserSearch(e.target.value)}
            className="h-9.5 w-full rounded-lg border border-border bg-background pl-9.5 pr-8 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1">
          {roleFilterOptions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChangeUserRoleFilter(r)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-sm font-bold capitalize transition cursor-pointer',
                effectiveRoleFilter === r
                  ? 'bg-indigo-600 text-white'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">User Profile</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Business Affiliation</th>
                <th className="px-4 py-3">Member Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground font-semibold text-sm">
                    No platform users found.
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const initials = (u.displayName || 'User')
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  return (
                    <tr key={u.id} className="hover:bg-muted/15 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-7.5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shrink-0">
                            {initials}
                          </div>
                          <span className="font-bold text-foreground text-sm">
                            {u.displayName || 'No Name Set'}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
                            u.role === 'owner'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          )}
                        >
                          {u.role}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {u.businessName ? (
                          <span className="font-semibold text-foreground text-sm">{u.businessName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-xs text-muted-foreground font-semibold">
                        {formatIstDate(u.createdAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Platform Users Pagination Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-border/60 bg-muted/20 text-xs font-semibold text-muted-foreground">
          <div>
            {filteredUsers.length === 0 ? (
              <span>No platform users found</span>
            ) : (
              <span>
                Showing <strong className="text-foreground font-bold">{(safeUserPage - 1) * ROWS_PER_PAGE + 1}</strong>–
                <strong className="text-foreground font-bold">{Math.min(safeUserPage * ROWS_PER_PAGE, filteredUsers.length)}</strong> of{' '}
                <strong className="text-foreground font-bold">{filteredUsers.length}</strong> platform {filteredUsers.length === 1 ? 'user' : 'users'}
              </span>
            )}
          </div>

          {totalUserPages > 1 && (
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                disabled={safeUserPage <= 1}
                onClick={() => onSetUserPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted font-bold text-foreground text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                <ChevronLeft className="size-3.5" /> Previous
              </button>

              {getVisiblePageNumbers(safeUserPage, totalUserPages).map((pNum, idx) => {
                if (pNum === '...') {
                  return (
                    <span key={`user-ellipsis-${idx}`} className="px-1.5 py-1 text-muted-foreground select-none">
                      ...
                    </span>
                  );
                }
                const num = pNum as number;
                const isActive = safeUserPage === num;
                return (
                  <button
                    key={`user-page-${num}`}
                    type="button"
                    onClick={() => onSetUserPage(num)}
                    className={cn(
                      'min-w-[28px] h-7 px-2 rounded-lg font-bold text-xs transition cursor-pointer',
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'border border-border bg-background hover:bg-muted text-foreground'
                    )}
                  >
                    {num}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={safeUserPage >= totalUserPages}
                onClick={() => onSetUserPage((p) => Math.min(totalUserPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted font-bold text-foreground text-xs disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                Next <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

