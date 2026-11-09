import type { MetadataRoute } from 'next';
import {
  PRIVATE_PATH_PREFIXES,
  siteOrigin,
  isIndexableDeployment,
} from '@/lib/seo/routes';

export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    };
  }

  const origin = siteOrigin();
  // robots.txt rules are prefix matches, so '/admin' also covers '/admin/' and everything below it.
  const disallowPatterns: string[] = [...PRIVATE_PATH_PREFIXES];

  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/privacy', '/terms'],
      disallow: disallowPatterns,
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

