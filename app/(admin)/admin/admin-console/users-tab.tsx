'use client';

import { Search, ChevronLeft, ChevronRight, Edit3, Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { getVisiblePageNumbers, ROWS_PER_PAGE } from './pagination';
import type { UserItem } from './types';
import type { UserRoleFilter } from './use-user-directory';

interface UsersTabProps {
  totalUsersCount: number;
  filteredUsers: UserItem[];
  paginatedUsers: UserItem[];
  userSearch: string;
  roleFilterOptions: readonly UserRoleFilter[];
  effectiveRoleFilter: UserRoleFilter;
  totalUserPages: number;
  safeUserPage: number;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onChangeUserSearch: (value: string) => void;
  onChangeUserRoleFilter: (role: UserRoleFilter) => void;
  onSetUserPage: (page: number | ((p: number) => number)) => void;
  onEditIdentity: (businessId: string) => void;
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
  copiedKey,
  onCopy,
  onChangeUserSearch,
  onChangeUserRoleFilter,
  onSetUserPage,
  onEditIdentity,
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
            placeholder="Search users by name, email, or business affiliation..."
            value={userSearch}
            onChange={(e) => onChangeUserSearch(e.target.value)}
            className="h-9.5 w-full rounded-lg border border-border bg-background pl-9.5 pr-8 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        {/* Phones: one card per user with every column of the table row. */}
        <ul className="divide-y divide-border/40 md:hidden">
          {paginatedUsers.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm font-semibold text-muted-foreground">No platform users found.</li>
          ) : (
            paginatedUsers.map((u) => {
              const email = u.email?.trim() || null;
              return (
                <li key={u.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground [overflow-wrap:anywhere]">{u.displayName || 'No Name Set'}</p>
                      <div className="mt-0.5 flex items-start gap-1.5 text-xs font-medium text-muted-foreground">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{email ?? 'E-mail not available'}</span>
                        {email && (
                          <button
                            type="button"
                            onClick={() => onCopy(email, `email-${u.id}`)}
                            className="shrink-0 cursor-pointer transition hover:text-indigo-600"
                            aria-label="Copy email address"
                          >
                            {copiedKey === `email-${u.id}` ? <Check className="size-3.5 text-emerald-700" /> : <Copy className="size-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border',
                        u.role === 'owner' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-700 border-slate-200'
                      )}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {u.businessName ? <span className="font-semibold text-foreground">{u.businessName}</span> : <span className="italic">Unassigned</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">Since {formatIstDate(u.createdAt)}</span>
                  </div>
                  {u.businessId && (
                    <button
                      type="button"
                      onClick={() => {
                        if (u.businessId) onEditIdentity(u.businessId);
                      }}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-indigo-300 bg-background px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-400 cursor-pointer"
                    >
                      <Edit3 className="size-3.5 shrink-0" />
                      <span>Correct GSTIN / State</span>
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-auto text-left text-sm border-collapse [&_th]:align-middle [&_td]:align-middle">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <th scope="col" className="w-full min-w-[24rem] px-4 py-3 whitespace-nowrap">User Profile</th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Role</th>
                <th scope="col" className="min-w-[16rem] px-4 py-3 whitespace-nowrap">Business Affiliation</th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Member Since</th>
                <th scope="col" className="w-px px-4 py-3 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground font-semibold text-sm">
                    No platform users found.
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const email = u.email?.trim() || null;
                  const initials = (u.displayName || 'User')
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  return (
                    <tr key={u.id} className="hover:bg-muted/15 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex min-w-[22rem] items-center gap-2.5">
                          <div className="flex size-7.5 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block font-bold text-foreground text-sm [overflow-wrap:anywhere]">
                              {u.displayName || 'No Name Set'}
                            </span>
                            <div className="mt-0.5 flex items-start gap-1.5 text-xs font-medium text-muted-foreground">
                              <span className="shrink-0 whitespace-nowrap">Email ID:</span>
                              <span className="min-w-0 [overflow-wrap:anywhere]">{email ?? 'Not available'}</span>
                              {email && (
                                <button
                                  type="button"
                                  onClick={() => onCopy(email, `email-${u.id}`)}
                                  className="shrink-0 hover:text-indigo-600 transition cursor-pointer"
                                  aria-label="Copy email address"
                                  title="Copy email address"
                                >
                                  {copiedKey === `email-${u.id}` ? (
                                    <Check className="size-3.5 text-emerald-700" />
                                  ) : (
                                    <Copy className="size-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
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
                          <span className="block max-w-[28rem] font-semibold text-foreground text-sm [overflow-wrap:anywhere]">{u.businessName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap tabular-nums text-xs text-muted-foreground font-semibold">
                        {formatIstDate(u.createdAt)}
                      </td>

                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {u.businessId ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (u.businessId) onEditIdentity(u.businessId);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-background hover:bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-400 transition cursor-pointer"
                            title="Correct GSTIN / State for affiliated business"
                          >
                            <Edit3 className="size-3.5 shrink-0" />
                            <span>Correct GSTIN / State</span>
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground select-none">—</span>
                        )}
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

