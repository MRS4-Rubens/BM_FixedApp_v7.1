import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_TAGLINE, BRAND_TITLE } from '@/lib/config/brand';

export const alt = BRAND_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const logo = await readFile(join(process.cwd(), 'public/branding/invoice-bizfolio-primary-preview.png'));
  const logoSource = `data:image/png;base64,${logo.toString('base64')}`;

  return new ImageResponse(
    (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        borderTop: '16px solid #880019',
        backgroundColor: '#fcfaf6',
        padding: '80px',
      }}>
        {/* ImageResponse embeds the PNG bytes directly into the preview (no-img-element is off for this file in eslint.config.mjs). */}
        <img src={logoSource} alt="" width={840} height={174} />
        <div style={{ color: '#292524', fontSize: 35, marginTop: 24 }}>
          {BRAND_TAGLINE}
        </div>
      </div>
    ),
    size,
  );
}
