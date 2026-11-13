import { describe, expect, it } from 'vitest';
import {
  cleanSignature,
  detectInkColour,
  estimatePaperLuminance,
  INK_COLOURS,
  luminance,
  SIGNATURE_OUTPUT_HEIGHT,
  SIGNATURE_OUTPUT_WIDTH,
  SignatureImageData,
  validateCoverage,
} from '@/lib/signature/process-signature';
import {
  SIGNATURE_MAX_WIDTH_PX,
  SIGNATURE_MIN_WIDTH_PX,
} from '@/lib/security/signature-limits';

function createImage(
  width: number,
  height: number,
  fillRgb: [number, number, number] = [255, 255, 255]
): SignatureImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = fillRgb[0];
    data[idx + 1] = fillRgb[1];
    data[idx + 2] = fillRgb[2];
    data[idx + 3] = 255;
  }
  return { data, width, height };
}

describe('SPEC: Signature image processing & clean-up (SIG-B1)', () => {
  it('1. white image produces coverage 0, every alpha 0, and validateCoverage reports empty', () => {
    const img = createImage(100, 100, [255, 255, 255]);
    const { image: cleaned, coverage } = cleanSignature(img, { ink: 'black', strength: 50 });

    expect(coverage).toBe(0);
    expect(validateCoverage(coverage)).toEqual({ ok: false, reason: 'empty' });

    for (let i = 0; i < cleaned.data.length; i += 4) {
      expect(cleaned.data[i + 3]).toBe(0); // alpha 0
      expect(cleaned.data[i]).toBe(0);     // R 0
      expect(cleaned.data[i + 1]).toBe(0); // G 0
      expect(cleaned.data[i + 2]).toBe(0); // B 0
    }
  });

  it('2. black strokes on white yield stroke pixels with alpha 255 and RGB = INK_COLOURS.black, and background alpha 0', () => {
    const img = createImage(100, 100, [255, 255, 255]);
    // Draw 100 black stroke pixels
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      img.data[idx] = 0;
      img.data[idx + 1] = 0;
      img.data[idx + 2] = 0;
    }

    const { image: cleaned } = cleanSignature(img, { ink: 'black', strength: 50 });

    // Stroke pixels (first 100)
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      expect(cleaned.data[idx]).toBe(INK_COLOURS.black[0]);
      expect(cleaned.data[idx + 1]).toBe(INK_COLOURS.black[1]);
      expect(cleaned.data[idx + 2]).toBe(INK_COLOURS.black[2]);
      expect(cleaned.data[idx + 3]).toBe(255);
    }

    // Remaining background pixels
    for (let i = 100; i < 10000; i++) {
      const idx = i * 4;
      expect(cleaned.data[idx + 3]).toBe(0);
    }
  });

  it('3. detects blue strokes (e.g. 20,40,200) as "blue" and dark grey strokes as "black"', () => {
    const blueImg = createImage(100, 100, [250, 250, 250]);
    // Insert blue strokes
    for (let i = 0; i < 200; i++) {
      const idx = i * 4;
      blueImg.data[idx] = 20;
      blueImg.data[idx + 1] = 40;
      blueImg.data[idx + 2] = 200;
    }
    const paperBlue = estimatePaperLuminance(blueImg);
    expect(detectInkColour(blueImg, paperBlue)).toBe('blue');

    const greyImg = createImage(100, 100, [250, 250, 250]);
    // Insert dark grey strokes (30, 30, 30)
    for (let i = 0; i < 200; i++) {
      const idx = i * 4;
      greyImg.data[idx] = 30;
      greyImg.data[idx + 1] = 30;
      greyImg.data[idx + 2] = 30;
    }
    const paperGrey = estimatePaperLuminance(greyImg);
    expect(detectInkColour(greyImg, paperGrey)).toBe('black');
  });

  it('4. red ink recoloured: cleanSignature with ink "black" turns red stroke pixels to INK_COLOURS.black with no red left', () => {
    const img = createImage(100, 100, [255, 255, 255]);
    // Red strokes (200, 0, 0)
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      img.data[idx] = 200;
      img.data[idx + 1] = 0;
      img.data[idx + 2] = 0;
    }

    const { image: cleaned } = cleanSignature(img, { ink: 'black', strength: 50 });

    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      expect(cleaned.data[idx]).toBe(INK_COLOURS.black[0]);
      expect(cleaned.data[idx + 1]).toBe(INK_COLOURS.black[1]);
      expect(cleaned.data[idx + 2]).toBe(INK_COLOURS.black[2]);
      expect(cleaned.data[idx]).not.toBe(200);
    }
  });

  it('5. higher strength removes a light-grey shadow (lum ~ 200 on paper 250) that strength 0 keeps partially', () => {
    // 1000 pixels: 900 pixels at white (250, 250, 250), 100 pixels at light grey shadow (200, 200, 200)
    const img = createImage(100, 10, [250, 250, 250]);
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      img.data[idx] = 200;
      img.data[idx + 1] = 200;
      img.data[idx + 2] = 200;
    }

    // At strength 0: hi = 250 * 0.92 = 230, lo = 138.
    // Shadow lum = 200 < hi(230), so alpha > 0 (partially kept).
    const resLow = cleanSignature(img, { ink: 'black', strength: 0 });
    const shadowAlphaLow = resLow.image.data[3];
    expect(shadowAlphaLow).toBeGreaterThan(0);

    // At strength 100: hi = 250 * 0.72 = 180.
    // Shadow lum = 200 >= hi(180), so alpha = 0 (shadow completely removed).
    const resHigh = cleanSignature(img, { ink: 'black', strength: 100 });
    const shadowAlphaHigh = resHigh.image.data[3];
    expect(shadowAlphaHigh).toBe(0);
  });

  it('6. fully-inked image results in validateCoverage returning too_much', () => {
    // 50% of the frame is dark ink on white paper (coverage > 35%)
    const img = createImage(100, 100, [255, 255, 255]);
    for (let i = 0; i < 5000; i++) {
      const idx = i * 4;
      img.data[idx] = 0;
      img.data[idx + 1] = 0;
      img.data[idx + 2] = 0;
    }
    const { coverage } = cleanSignature(img, { ink: 'black', strength: 50 });

    expect(coverage).toBe(0.5);
    expect(validateCoverage(coverage)).toEqual({ ok: false, reason: 'too_much' });
    expect(validateCoverage(1.0)).toEqual({ ok: false, reason: 'too_much' });
  });

  it('7. SIGNATURE_OUTPUT_WIDTH === 3 * SIGNATURE_OUTPUT_HEIGHT and within SIGNATURE_MIN_WIDTH_PX..SIGNATURE_MAX_WIDTH_PX', () => {
    expect(SIGNATURE_OUTPUT_WIDTH).toBe(3 * SIGNATURE_OUTPUT_HEIGHT);
    expect(SIGNATURE_OUTPUT_WIDTH).toBeGreaterThanOrEqual(SIGNATURE_MIN_WIDTH_PX);
    expect(SIGNATURE_OUTPUT_WIDTH).toBeLessThanOrEqual(SIGNATURE_MAX_WIDTH_PX);
  });

  it('8. estimatePaperLuminance returns ~250 for an image 95% at lum 250 and 5% at lum 20', () => {
    // 1000 pixels: 950 at (250, 250, 250) and 50 at (20, 20, 20)
    const img = createImage(100, 10, [250, 250, 250]);
    for (let i = 0; i < 50; i++) {
      const idx = i * 4;
      img.data[idx] = 20;
      img.data[idx + 1] = 20;
      img.data[idx + 2] = 20;
    }

    const estimatedPaper = estimatePaperLuminance(img);
    expect(estimatedPaper).toBe(250);
  });

  it('9. luminance calculates standard Rec. 601 perceived luminance', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 1);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(100, 0, 0)).toBeCloseTo(29.9, 1);
    expect(luminance(0, 100, 0)).toBeCloseTo(58.7, 1);
    expect(luminance(0, 0, 100)).toBeCloseTo(11.4, 1);
  });
});
