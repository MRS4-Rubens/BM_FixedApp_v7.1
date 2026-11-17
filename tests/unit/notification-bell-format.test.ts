import { describe, expect, it } from 'vitest';
import { badgeText, relativeTime, safeInternalLink } from '@/components/app/notifications/notification-format';

describe('Feature C: bell helpers', () => {
  it('badge: nothing at zero, the number up to 9, then 9+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
  });

  it('relative time from just now to an IST date', () => {
    const now = new Date('2026-12-08T04:00:00Z');
    expect(relativeTime('2026-12-08T03:59:30Z', now)).toBe('Just now');
    expect(relativeTime('2026-12-08T03:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-12-08T01:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-12-07T03:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-12-04T04:00:00Z', now)).toBe('4 days ago');
    expect(relativeTime('2026-11-12T04:00:00Z', now)).toBe('12 Nov');
    expect(relativeTime('2026-12-09T04:00:00Z', now)).toBe('Just now'); // clock skew never shows negatives
  });

  it('only in-app links are followed', () => {
    expect(safeInternalLink('/invoices?status=overdue')).toBe('/invoices?status=overdue');
    expect(safeInternalLink('//evil.example')).toBeNull();
    expect(safeInternalLink('https://evil.example')).toBeNull();
    expect(safeInternalLink(null)).toBeNull();
  });
});
