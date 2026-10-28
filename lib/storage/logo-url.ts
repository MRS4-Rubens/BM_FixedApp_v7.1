/**
 * Pure helpers for logo URLs and MIME types (COMP-001).
 * Safe for client-side and server-side usage (zero server/node dependencies).
 */

export function logoMimeFromKey(key: string): string {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerKey.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerKey.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'image/png';
}

export function buildLogoUrl(businessId: string, key: string): string {
  return `/api/business/${businessId}/logo?k=${encodeURIComponent(key)}`;
}
