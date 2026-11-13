import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyInkColour,
  estimatePaperLuminance,
  findInkBounds,
  assessSignature,
  fitRectForSignature,
  type SignatureImageData,
  type InkBounds,
} from '@/lib/signature/process-signature';
import {
  REJECTION_MESSAGES,
  SIGNATURE_UPLOAD_RULES,
  CROP_HOW_TO,
} from '@/lib/signature/upload-rules';

function createSyntheticImage(
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

function drawRect(
  img: SignatureImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number]
) {
  for (let row = y; row < y + h; row++) {
    if (row < 0 || row >= img.height) continue;
    const offset = row * img.width;
    for (let col = x; col < x + w; col++) {
      if (col < 0 || col >= img.width) continue;
      const idx = (offset + col) * 4;
      img.data[idx] = rgb[0];
      img.data[idx + 1] = rgb[1];
      img.data[idx + 2] = rgb[2];
      img.data[idx + 3] = 255;
    }
  }
}

describe('SIG-B3: Signature Autofit & Processing Helpers', () => {
  describe('classifyInkColour', () => {
    it('classifies black strokes as "black"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 20, 20, 60, 20, [20, 20, 20]);
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('black');
      expect(res.inkPixels).toBe(60 * 20);
    });

    it('classifies blue strokes (20, 40, 200) as "blue"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 20, 20, 60, 20, [20, 40, 200]);
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('blue');
      expect(res.blueShare).toBeGreaterThanOrEqual(0.3);
    });

    it('classifies dark navy (25, 35, 80) as "black" or "blue" but NEVER "other"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 20, 20, 60, 20, [25, 35, 80]);
      const res = classifyInkColour(img, 255);
      expect(['black', 'blue']).toContain(res.verdict);
      expect(res.verdict).not.toBe('other');
    });

    it('classifies red strokes (200, 30, 30) as "other"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 20, 20, 60, 20, [200, 30, 30]);
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('other');
      expect(res.otherShare).toBeGreaterThan(0.15);
    });

    it('classifies green strokes (30, 160, 40) as "other"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 20, 20, 60, 20, [30, 160, 40]);
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('other');
      expect(res.otherShare).toBeGreaterThan(0.15);
    });

    it('classifies a plain white image as "none"', () => {
      const img = createSyntheticImage(200, 100);
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('none');
      expect(res.inkPixels).toBe(0);
    });

    it('classifies mostly black with a few red pixels (< 10% of ink) as "black"', () => {
      const img = createSyntheticImage(200, 100);
      drawRect(img, 10, 10, 95, 20, [20, 20, 20]); // 1900 black pixels
      drawRect(img, 110, 10, 5, 20, [200, 30, 30]); // 100 red pixels (~5%)
      const res = classifyInkColour(img, 255);
      expect(res.verdict).toBe('black');
      expect(res.otherShare).toBeLessThan(0.15);
    });
  });

  describe('classifyInkColour under warm (yellow) room light — white balance', () => {
    // Paper photographed under a warm bulb looks cream; black ink edges look brown. Must still be "black".
    const WARM_PAPER: [number, number, number] = [240, 220, 180];

    it('black ink with brownish anti-aliased edges on cream paper → "black" (not "other")', () => {
      const img = createSyntheticImage(300, 100, WARM_PAPER);
      drawRect(img, 40, 40, 200, 6, [60, 50, 35]); // core stroke
      drawRect(img, 40, 36, 200, 4, [150, 135, 105]); // edge above
      drawRect(img, 40, 46, 200, 4, [150, 135, 105]); // edge below
      const res = classifyInkColour(img, estimatePaperLuminance(img));
      expect(res.verdict).toBe('black');
    });

    it('blue ink on cream paper → "blue"', () => {
      const img = createSyntheticImage(300, 100, WARM_PAPER);
      drawRect(img, 40, 40, 200, 10, [40, 50, 120]);
      expect(classifyInkColour(img, estimatePaperLuminance(img)).verdict).toBe('blue');
    });

    it('red ink on cream paper is still rejected → "other"', () => {
      const img = createSyntheticImage(300, 100, WARM_PAPER);
      drawRect(img, 40, 40, 200, 10, [180, 30, 25]);
      expect(classifyInkColour(img, estimatePaperLuminance(img)).verdict).toBe('other');
    });
  });

  describe('findInkBounds', () => {
    it('detects a stroke box at x 100-300, y 40-80 in a 600x300 image and ignores isolated single-pixel specks', () => {
      const img: SignatureImageData = {
        width: 600,
        height: 300,
        data: new Uint8ClampedArray(600 * 300 * 4), // all transparent (alpha 0)
      };

      // Draw stroke box from x=100 to 300 (inclusive, width 201), y=40 to 80 (inclusive, height 41)
      for (let y = 40; y <= 80; y++) {
        for (let x = 100; x <= 300; x++) {
          const idx = (y * 600 + x) * 4;
          img.data[idx + 3] = 255; // alpha >= 128
        }
      }

      // Add isolated single-pixel specks far away
      const speck1 = (250 * 600 + 500) * 4;
      img.data[speck1 + 3] = 255;
      const speck2 = (10 * 600 + 20) * 4;
      img.data[speck2 + 3] = 255;

      const bounds = findInkBounds(img);
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.x - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.y - 40)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.width - 201)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.height - 41)).toBeLessThanOrEqual(1);
    });

    it('returns null for empty image with no ink pixels', () => {
      const img: SignatureImageData = {
        width: 600,
        height: 300,
        data: new Uint8ClampedArray(600 * 300 * 4),
      };
      expect(findInkBounds(img)).toBeNull();
    });
  });

  describe('assessSignature', () => {
    it('rejects tall strokes as "portrait"', () => {
      const bounds: InkBounds = { x: 50, y: 50, width: 40, height: 200, inkPixels: 500 };
      const res = assessSignature(bounds, 600, 600);
      expect(res).toEqual({ ok: false, reason: 'portrait' });
    });

    it('rejects high density / solid filled rectangles as "too_busy"', () => {
      const bounds: InkBounds = { x: 50, y: 50, width: 200, height: 100, inkPixels: 15000 };
      const res = assessSignature(bounds, 600, 400);
      expect(res).toEqual({ ok: false, reason: 'too_busy' });
    });

    it('rejects full page / lined paper coverage as "too_busy"', () => {
      const bounds: InkBounds = { x: 0, y: 0, width: 590, height: 395, inkPixels: 60000 };
      const res = assessSignature(bounds, 600, 400);
      expect(res).toEqual({ ok: false, reason: 'too_busy' });
    });

    it('rejects tiny marks (< 150 ink pixels) as "empty"', () => {
      const bounds: InkBounds = { x: 50, y: 50, width: 50, height: 20, inkPixels: 5 };
      const res = assessSignature(bounds, 600, 400);
      expect(res).toEqual({ ok: false, reason: 'empty' });
    });

    it('rejects narrow marks (< 5% image width) as "empty"', () => {
      const bounds: InkBounds = { x: 50, y: 50, width: 20, height: 20, inkPixels: 200 };
      const res = assessSignature(bounds, 600, 400);
      expect(res).toEqual({ ok: false, reason: 'empty' });
    });

    it('accepts normal wide strokes', () => {
      const bounds: InkBounds = { x: 100, y: 50, width: 300, height: 80, inkPixels: 2500 };
      const res = assessSignature(bounds, 600, 300);
      expect(res).toEqual({ ok: true });
    });
  });

  describe('fitRectForSignature', () => {
    const testCases: Array<{ name: string; bounds: InkBounds }> = [
      { name: 'very wide signature', bounds: { x: 100, y: 80, width: 400, height: 60, inkPixels: 2000 } },
      { name: 'near-square signature', bounds: { x: 100, y: 50, width: 180, height: 150, inkPixels: 2000 } },
      { name: 'tall-ish signature', bounds: { x: 100, y: 50, width: 140, height: 120, inkPixels: 2000 } },
    ];

    for (const { name, bounds } of testCases) {
      it(`enforces exact 3:1 aspect ratio and full containment for ${name}`, () => {
        const rect = fitRectForSignature(bounds);

        // Aspect ratio 3:1 within 1e-9
        expect(Math.abs(rect.sw - 3 * rect.sh)).toBeLessThan(1e-9);

        // Padded rect must fully contain the bounds
        expect(rect.sx).toBeLessThanOrEqual(bounds.x);
        expect(rect.sy).toBeLessThanOrEqual(bounds.y);
        expect(rect.sx + rect.sw).toBeGreaterThanOrEqual(bounds.x + bounds.width);
        expect(rect.sy + rect.sh).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      });
    }
  });

  describe('REJECTION_MESSAGES & upload-rules', () => {
    it('has an entry for every SignatureRejection plus too_large and unreadable', () => {
      const expectedKeys = ['empty', 'too_busy', 'portrait', 'wrong_colour', 'too_large', 'unreadable'] as const;
      for (const k of expectedKeys) {
        expect(REJECTION_MESSAGES[k]).toBeDefined();
        expect(REJECTION_MESSAGES[k].title.length).toBeGreaterThan(0);
        expect(REJECTION_MESSAGES[k].fix.length).toBeGreaterThan(0);
        expect(typeof REJECTION_MESSAGES[k].showCropHelp).toBe('boolean');
      }
    });

    it('contains no occurrence of /digital\\s+signature/i in upload-rules.ts', () => {
      const rulesPath = path.resolve(process.cwd(), 'lib/signature/upload-rules.ts');
      const content = fs.readFileSync(rulesPath, 'utf-8');
      expect(content).not.toMatch(/digital\s+signature/i);
    });

    it('exports rules and how-to arrays', () => {
      expect(SIGNATURE_UPLOAD_RULES.length).toBeGreaterThan(0);
      expect(CROP_HOW_TO.length).toBeGreaterThan(0);
    });
  });
});

