/**
 * SERVER-ONLY: Never import this module from client components.
 *
 * Generates local SVG QR codes for payment URIs using the `qrcode` library on the server.
 * Keeping this server-only keeps the library out of the browser bundle and prevents payee
 * data (VPA, amount, customer intent notes) from leaking to third-party rendering services.
 */

import QRCode from 'qrcode';

/**
 * Renders a URI into a standalone SVG data URL.
 * Error correction level 'M' (15%) is standard for mobile payment QR codes.
 */
export async function buildUpiQrDataUrl(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
  });

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

