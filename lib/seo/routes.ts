import { getAppEnv } from '@/lib/env';

export const PUBLIC_MARKETING_PATHS = ['/', '/privacy', '/terms'] as const;

export const PRIVATE_PATH_PREFIXES = [
  '/dashboard',
  '/invoices',
  '/credit-notes',
  '/customers',
  '/products',
  '/reports',
  '/settings',
  '/checkout',
  '/dev-boundary-test',
  '/admin',
  '/api',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
] as const;

export function siteOrigin(): string {
  return new URL(getAppEnv().NEXT_PUBLIC_APP_URL).origin;
}

export function isIndexableDeployment(source: Record<string, string | undefined> = process.env): boolean {
  return source.VERCEL_ENV === 'production';
}

