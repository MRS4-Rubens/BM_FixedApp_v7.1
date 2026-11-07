/**
 * Pure helpers for logo URLs and MIME types (COMP-001, PERF-003).
 * Safe for client-side and server-side usage (zero server/node dependencies).
 */

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

export const MAX_LOGO_KEY_LENGTH = 300;

export function logoMimeFromKey(key: string): LogoMime | null {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerKey.endsWith('.webp')) {
    return 'image/webp';
  }
  return null;
}

export function buildLogoUrl(businessId: string, key: string): string {
  return `/api/business/${businessId}/logo?k=${encodeURIComponent(key)}`;
}
