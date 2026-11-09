import { ImageResponse } from 'next/og';

export const alt = 'Bill Matrix — Smart GST Invoicing for Indian Businesses';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: '#1e2a4a',
          padding: '80px',
        }}
      >
        <div
          style={{
            color: '#ffffff',
            fontSize: 72,
            fontWeight: 700,
            marginBottom: 24,
            letterSpacing: '-0.02em',
          }}
        >
          Bill Matrix
        </div>
        <div
          style={{
            color: '#cbd5e1',
            fontSize: 32,
            fontWeight: 400,
            lineHeight: 1.4,
            maxWidth: '900px',
          }}
        >
          Smart GST Invoicing for Indian Businesses
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}

