import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { PRIVATE_PATH_PREFIXES, siteOrigin } from '@/lib/seo/routes';

describe('FE-006: app/robots.ts and app/sitemap.ts metadata routes', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.billmatrix.in');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('robots()', () => {
    it('returns disallow all rules for non-production preview deployments', () => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      const result = robots();

      expect(result).toEqual({
        rules: {
          userAgent: '*',
          disallow: '/',
        },
      });
      expect(result.sitemap).toBeUndefined();
      expect(result.host).toBeUndefined();
    });

    it('returns disallow all rules when VERCEL_ENV is undefined or development', () => {
      vi.stubEnv('VERCEL_ENV', undefined);
      const resultUndef = robots();
      expect(resultUndef).toEqual({
        rules: {
          userAgent: '*',
          disallow: '/',
        },
      });

      vi.stubEnv('VERCEL_ENV', 'development');
      const resultDev = robots();
      expect(resultDev).toEqual({
        rules: {
          userAgent: '*',
          disallow: '/',
        },
      });
    });

    it('returns full allow/disallow matrix, sitemap, and host in production', () => {
      vi.stubEnv('VERCEL_ENV', 'production');
      const result = robots();
      const origin = siteOrigin();

      expect(result.host).toBe(origin);
      expect(result.sitemap).toBe(`${origin}/sitemap.xml`);

      const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
      expect(rules.userAgent).toBe('*');
      expect(rules.allow).toEqual(['/', '/privacy', '/terms']);

      const disallowList = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
      for (const prefix of PRIVATE_PATH_PREFIXES) {
        expect(disallowList).toContain(prefix);
      }
      expect(disallowList).toHaveLength(PRIVATE_PATH_PREFIXES.length);
      // A public page must never be blocked by a private prefix rule.
      for (const publicPath of ['/privacy', '/terms']) {
        expect(disallowList.some((rule) => rule !== undefined && publicPath.startsWith(rule))).toBe(false);
      }
    });
  });

  describe('sitemap()', () => {
    it('returns empty array when VERCEL_ENV is not production (preview or undefined)', () => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      expect(sitemap()).toEqual([]);

      vi.stubEnv('VERCEL_ENV', undefined);
      expect(sitemap()).toEqual([]);
    });

    it('returns deterministic sitemap entries in production with expected priorities and frequencies', () => {
      vi.stubEnv('VERCEL_ENV', 'production');
      const origin = siteOrigin();
      const result = sitemap();

      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        url: origin,
        changeFrequency: 'weekly',
        priority: 1,
      });

      expect(result[1]).toEqual({
        url: `${origin}/privacy`,
        changeFrequency: 'yearly',
        priority: 0.3,
      });

      expect(result[2]).toEqual({
        url: `${origin}/terms`,
        changeFrequency: 'yearly',
        priority: 0.3,
      });

      // No lastModified (keeps builds deterministic)
      for (const entry of result) {
        expect('lastModified' in entry).toBe(false);
      }
    });
  });
});

