import { formatIstDate } from '@/lib/invoices/ist-date';

/** Feature C: small pure helpers for the bell (unit-tested). */

/** "9+" above nine, nothing at zero. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", then an IST date like "12 Nov". */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatIstDate(then, { day: 'numeric', month: 'short' });
}

/** Only ever follow in-app paths ("/..."), never "//host" or absolute URLs. */
export function safeInternalLink(link: string | null): string | null {
  if (link === null || !link.startsWith('/') || link.startsWith('//')) return null;
  return link;
}
