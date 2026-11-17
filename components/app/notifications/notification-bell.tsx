'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationList, NotificationListItem } from '@/lib/notifications/list';
import { markNotificationsRead } from '@/lib/actions/notifications/mark-notifications-read';
import { badgeText, relativeTime, safeInternalLink } from './notification-format';

/** Re-check for new items this often while the tab is visible (and whenever the window regains focus). */
const REFRESH_MS = 120_000;

function isNotificationList(value: unknown): value is NotificationList {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) && typeof record.unreadCount === 'number';
}

/**
 * Reads the list from GET /api/notifications. A plain fetch, NOT a server action: Next.js runs server actions one at
 * a time per tab, so background polling through an action could delay or disturb what the user is doing.
 */
async function fetchNotifications(): Promise<NotificationList | null> {
  try {
    const response = await fetch('/api/notifications', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isNotificationList(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Feature C: the bell in the top bar. Shows an unread badge; clicking opens the newest 20 items.
 * Opening an item marks it read and follows its in-app link. Data is loaded in the browser after mount, so the
 * server render (no badge) never mismatches.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Every refresh and every read-change takes a new number. A refresh only applies its result if nothing newer
  // started meanwhile, so a slow refresh can never overwrite a newer "marked as read" on screen.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    const result = await fetchNotifications();
    if (mine !== generation.current) return;
    setNow(new Date());
    if (result) {
      setItems(result.items);
      setUnread(result.unreadCount);
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Initial load after mount (async, so no synchronous setState inside the effect body).
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void refresh();
  }

  function openItem(item: NotificationListItem) {
    if (!item.read) {
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)));
      setUnread((count) => Math.max(0, count - 1));
      generation.current += 1; // discard any refresh already in flight
      void markNotificationsRead({ ids: [item.id] }).then(() => refresh());
    }
    const link = safeInternalLink(item.link);
    if (link) {
      setOpen(false);
      router.push(link);
    }
  }

  async function markAll() {
    setItems((current) => current.map((entry) => ({ ...entry, read: true })));
    setUnread(0);
    generation.current += 1; // discard any refresh already in flight
    await markNotificationsRead({ all: true });
    void refresh();
  }

  const badge = badgeText(unread);
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'No unread notifications'}
        className={cn(
          'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-indigo-500/10 hover:text-indigo-600 transition-all duration-200 border border-transparent hover:border-indigo-500/20 cursor-pointer',
          open && 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
        )}
      >
        <Bell className="size-4" />
        {badge && (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-4 text-center shadow-sm"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-14 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] rounded-2xl border border-border/70 bg-card shadow-2xl shadow-slate-900/15 dark:shadow-black/50 animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <p className="text-sm font-extrabold text-foreground font-heading">Notifications</p>
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={unread === 0}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-500/10 disabled:text-muted-foreground disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
            >
              <CheckCheck className="size-3.5" />
              Mark all as read
            </button>
          </div>

          <div className="max-h-[min(420px,60dvh)] overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : failed && items.length === 0 ? (
              <p role="alert" className="px-4 py-8 text-center text-sm text-muted-foreground">
                Notifications could not be loaded. Please try again.
              </p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-bold text-foreground">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Overdue invoices, GST deadlines and plan reminders will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn(
                        'flex w-full gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent/60 cursor-pointer',
                        !item.read && 'bg-indigo-50/60 dark:bg-indigo-500/5',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : 'bg-indigo-600')}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm leading-snug text-foreground', !item.read && 'font-bold')}>
                          {!item.read && <span className="sr-only">Unread: </span>}
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground line-clamp-2">{item.body}</span>
                        <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
                          {now ? relativeTime(item.createdAt, now) : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border/60 px-4 py-2.5">
            <Link
              href="/settings?tab=notifications"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-indigo-600"
            >
              <Settings2 className="size-3.5" />
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
