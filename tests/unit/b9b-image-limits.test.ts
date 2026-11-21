import { describe, expect, it } from 'vitest';
import { fitWithin, formatBytes, shrinkAttempts } from '@/lib/images/shrink-image';
import { LOGO_MAX_BYTES, PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/security/upload-limits';
import { SIGNATURE_MAX_BYTES } from '@/lib/security/signature-limits';
import { quantiseInk, signatureOutputWidths } from '@/components/app/settings/signature-canvas';

describe('B9b stored image limits (owner decision)', () => {
  it('logo 30 KB, signature 20 KB, payment screenshot 50 KB', () => {
    expect(LOGO_MAX_BYTES).toBe(30 * 1024);
    expect(SIGNATURE_MAX_BYTES).toBe(20 * 1024);
    expect(PAYMENT_SCREENSHOT_MAX_BYTES).toBe(50 * 1024);
  });
});

describe('B9b in-browser shrinker plan', () => {
  it('tries the largest, sharpest version first and ends at the smallest useful size', () => {
    const attempts = shrinkAttempts(1280, 640);
    expect(attempts[0]).toEqual({ edge: 1280, quality: 0.9 });
    expect(attempts.at(-1)?.edge).toBe(640);
    const edges = [...new Set(attempts.map((a) => a.edge))];
    expect(edges).toEqual([...edges].sort((a, b) => b - a));
    expect(edges.every((e) => e >= 640)).toBe(true);
  });

  it('keeps the aspect ratio and never upscales', () => {
    expect(fitWithin(1080, 2400, 1280)).toEqual({ width: 576, height: 1280 });
    expect(fitWithin(300, 100, 600)).toEqual({ width: 300, height: 100 });
  });

  it('formats sizes for people', () => {
    expect(formatBytes(24 * 1024)).toBe('24 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });
});

describe('B9b signature output sizes', () => {
  it('steps 900 -> 300 px wide, all within the server rule (300..1500, 3:1)', () => {
    const widths = signatureOutputWidths();
    expect(widths).toEqual([900, 750, 600, 450, 300]);
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(300);
      expect(w % 3).toBe(0);
    }
  });
});

describe('B9b signature ink quantising', () => {
  it('uses one ink colour, rounds alpha to 16 levels and keeps the background transparent', () => {
    const data = new Uint8ClampedArray([5, 6, 7, 0, 30, 40, 50, 200, 1, 2, 3, 3]);
    quantiseInk(data, [17, 24, 39]);
    expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...data.slice(4, 8)]).toEqual([17, 24, 39, 204]);
    expect([...data.slice(8, 12)]).toEqual([17, 24, 39, 17]);
  });
});
