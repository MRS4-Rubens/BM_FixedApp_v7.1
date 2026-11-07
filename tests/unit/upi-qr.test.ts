import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { buildUpiQrDataUrl } from '@/lib/payments/upi-qr';

describe('UPI QR SVG Data URL Builder (FE-005)', () => {
  const sampleUri =
    'upi://pay?pa=billmatrix@okaxis&pn=Bill%20Matrix%20Pvt%20Ltd&am=399.00&cu=INR&tn=BM%20Sub%20Essentials%20Pro%20Plan%20monthly';

  it('returns a data:image/svg+xml URL containing an SVG element', async () => {
    const dataUrl = await buildUpiQrDataUrl(sampleUri);

    expect(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svgContent = decodeURIComponent(dataUrl.replace('data:image/svg+xml;charset=utf-8,', ''));
    expect(svgContent).toContain('<svg');
    expect(svgContent).toContain('</svg>');
    expect(svgContent).toContain('viewBox=');
  });

  it('preserves exact URI payload round-trip proof via QRCode.create', () => {
    const qr = QRCode.create(sampleUri, { errorCorrectionLevel: 'M' });

    // Join decoded segment payloads
    const decodedPayload = qr.segments
      .map((segment) =>
        typeof segment.data === 'string'
          ? segment.data
          : new TextDecoder().decode(segment.data)
      )
      .join('');

    expect(decodedPayload).toBe(sampleUri);
  });
});

