import { describe, expect, it } from 'vitest';
import { amountInWordsIndian } from '@/lib/pdf/number-to-words';
import { mulberry32, randomInt } from '../helpers/prng';

describe('Indian Currency Amount in Words (TEST-001)', () => {
  describe('SPEC: Canonical Word Conversions', () => {
    const canonicalCases: Array<[number, number, string]> = [
      [0, 0, 'Zero Rupees Only'],
      [1, 0, 'One Rupees Only'], // F-WORDS-1 cosmetic grammar note
      [19, 0, 'Nineteen Rupees Only'],
      [20, 0, 'Twenty Rupees Only'],
      [21, 0, 'Twenty One Rupees Only'],
      [99, 0, 'Ninety Nine Rupees Only'],
      [100, 0, 'One Hundred Rupees Only'],
      [101, 0, 'One Hundred One Rupees Only'],
      [999, 0, 'Nine Hundred Ninety Nine Rupees Only'],
      [1000, 0, 'One Thousand Rupees Only'],
      [1001, 0, 'One Thousand One Rupees Only'],
      [12345, 0, 'Twelve Thousand Three Hundred Forty Five Rupees Only'],
      [99999, 0, 'Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only'],
      [100000, 0, 'One Lakh Rupees Only'],
      [123456, 0, 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only'],
      [1000000, 0, 'Ten Lakh Rupees Only'],
      [9999999, 0, 'Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only'],
      [10000000, 0, 'One Crore Rupees Only'],
      [123456789, 0, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees Only'],
      [999999999, 0, 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only'],
      // With paise
      [0, 1, 'Zero Rupees and One Paise Only'],
      [0, 50, 'Zero Rupees and Fifty Paise Only'],
      [10, 5, 'Ten Rupees and Five Paise Only'],
      [1, 99, 'One Rupees and Ninety Nine Paise Only'],
    ];

    it.each(canonicalCases)('converts (%i rupees, %i paise) -> "%s"', (rupees, paise, expectedWords) => {
      expect(amountInWordsIndian(rupees, paise)).toBe(expectedWords);
    });
  });

  describe('PROP: Exhaustive Paise Word Table 1..99', () => {
    it('formats all paise values 1..99 with "Paise Only", no undefined, and no double spaces', () => {
      for (let p = 1; p <= 99; p++) {
        const text = amountInWordsIndian(0, p);
        expect(text).toContain('Zero Rupees and ');
        expect(text.endsWith('Paise Only')).toBe(true);
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('  ');
        expect(text.trim()).toBe(text);
      }
    });
  });

  describe('PROP: Invariants across 3,000 Random Rupee Values', () => {
    it('generates valid non-empty title-cased words for values under 10^9', () => {
      const prng = mulberry32(8888);
      for (let i = 0; i < 3000; i++) {
        const rupees = randomInt(prng, 0, 999_999_999);
        const paise = randomInt(prng, 0, 99);
        const text = amountInWordsIndian(rupees, paise);

        expect(text.endsWith('Only')).toBe(true);
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('  ');
        expect(/^[A-Z]/.test(text)).toBe(true);
      }
    });
  });

  describe('CHAR / F-WORDS-1: Known Limitations', () => {
    it('CHAR F-WORDS-1: non-integer float inputs are truncated via Math.floor', () => {
      // 12.9 rupees -> 12, 0.9 paise -> 0 paise (yielding empty paise section)
      expect(amountInWordsIndian(12.9, 0.9)).toBe('Twelve Rupees and  Paise Only');
    });

    it('CHAR F-WORDS-1: negative input yields empty words prefix', () => {
      expect(amountInWordsIndian(-100, 0)).toBe(' Rupees Only');
    });

    it.todo('F-WORDS-1: amountInWordsIndian should reject negative values or format as Minus/Negative');

    it('CHAR F-WORDS-1: >= 1,000 crore yields awkward "Ten Hundred Crore"', () => {
      // 10,000,000,000 rupees (1,000 crore)
      expect(amountInWordsIndian(10_000_000_000, 0)).toBe('Ten Hundred Crore Rupees Only');
    });

    it.todo('F-WORDS-1: amountInWordsIndian should correctly format numbers >= 1,000 crore (e.g. One Thousand Crore)');
  });
});
