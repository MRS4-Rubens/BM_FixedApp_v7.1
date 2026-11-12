import type { MetadataRoute } from 'next';
import { BRAND_DESCRIPTION, BRAND_NAME, BRAND_THEME_COLOR } from '@/lib/config/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND_NAME} — GST Invoicing`,
    short_name: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: BRAND_THEME_COLOR,
    icons: [
      {
        src: '/icon.svg',
        type: 'image/svg+xml',
        sizes: 'any',
      },
      {
        src: '/app-icon-192.png',
        type: 'image/png',
        sizes: '192x192',
      },
      {
        src: '/app-icon-512.png',
        type: 'image/png',
        sizes: '512x512',
      },
    ],
  };
}

