import type { MetadataRoute } from 'next';
import {
  PUBLIC_MARKETING_PATHS,
  siteOrigin,
  isIndexableDeployment,
} from '@/lib/seo/routes';

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexableDeployment()) {
    return [];
  }

  const origin = siteOrigin();

  return PUBLIC_MARKETING_PATHS.map((path) => {
    const isRoot = path === '/';
    return {
      url: `${origin}${isRoot ? '' : path}`,
      changeFrequency: isRoot ? 'weekly' : 'yearly',
      priority: isRoot ? 1 : 0.3,
    };
  });
}

