import { describe, expect, it } from 'vitest';
import { amountInWordsIndian, amountInWordsFromPaise } from '@/lib/pdf/number-to-words';
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

  describe('SPEC / F-WORDS-1: Validations and Multi-Crore Formatting', () => {
    it('rejects non-integer float inputs with RangeError', () => {
      expect(() => amountInWordsIndian(12.9, 0)).toThrow(RangeError);
      expect(() => amountInWordsIndian(12, 0.9)).toThrow(RangeError);
      expect(() => amountInWordsIndian(12.9, 0.9)).toThrow(RangeError);
    });

    it('rejects negative inputs and out-of-range paise with RangeError', () => {
      expect(() => amountInWordsIndian(-100, 0)).toThrow(RangeError);
      expect(() => amountInWordsIndian(0, -1)).toThrow(RangeError);
      expect(() => amountInWordsIndian(100, 100)).toThrow(RangeError);
      expect(() => amountInWordsIndian(NaN, 0)).toThrow(RangeError);
      expect(() => amountInWordsIndian(0, NaN)).toThrow(RangeError);
      expect(() => amountInWordsIndian(Infinity, 0)).toThrow(RangeError);
    });

    it('F-WORDS-1: amountInWordsIndian rejects negative values with RangeError', () => {
      expect(() => amountInWordsIndian(-1, 0)).toThrow(RangeError);
      expect(() => amountInWordsIndian(0, -5)).toThrow(RangeError);
    });

    it('formats >= 1,000 crore properly as "One Thousand Crore"', () => {
      // 10,000,000,000 rupees (1,000 crore)
      expect(amountInWordsIndian(10_000_000_000, 0)).toBe('One Thousand Crore Rupees Only');
    });

    it('F-WORDS-1: amountInWordsIndian correctly formats numbers >= 1,000 crore', () => {
      // 1,000 crore
      expect(amountInWordsIndian(1_000 * 10_000_000, 0)).toBe('One Thousand Crore Rupees Only');
      // 1,00,000 crore
      expect(amountInWordsIndian(100_000 * 10_000_000, 0)).toBe('One Lakh Crore Rupees Only');
      // 12,34,567 crore + 89,90,123 rupees
      expect(amountInWordsIndian(12_345_678_990_123, 0)).toBe(
        'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Crore Eighty Nine Lakh Ninety Thousand One Hundred Twenty Three Rupees Only'
      );
    });
  });

  describe('amountInWordsFromPaise', () => {
    it('correctly converts non-negative paise integers', () => {
      expect(amountInWordsFromPaise(0)).toBe('Zero Rupees Only');
      expect(amountInWordsFromPaise(1)).toBe('Zero Rupees and One Paise Only');
      expect(amountInWordsFromPaise(99)).toBe('Zero Rupees and Ninety Nine Paise Only');
      expect(amountInWordsFromPaise(100)).toBe('One Rupees Only');
      expect(amountInWordsFromPaise(39900)).toBe('Three Hundred Ninety Nine Rupees Only');
      expect(amountInWordsFromPaise(123456789)).toBe(
        'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Eighty Nine Paise Only'
      );
    });

    it('rejects negative, float, and NaN paise values with RangeError', () => {
      expect(() => amountInWordsFromPaise(-1)).toThrow(RangeError);
      expect(() => amountInWordsFromPaise(1.5)).toThrow(RangeError);
      expect(() => amountInWordsFromPaise(NaN)).toThrow(RangeError);
      expect(() => amountInWordsFromPaise(Infinity)).toThrow(RangeError);
    });
  });

  describe('EQUIVALENCE: Exactly matches legacy algorithm below 100 crore', () => {
    // Copy of the legacy algorithm before multi-crore refactor
    function legacyAmountInWordsIndian(rupees: number, paise: number): string {
      const ones = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen'
      ];
      const tens = [
        '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
      ];

      function convertGroup(n: number): string {
        let str = '';
        if (n > 99) {
          str += ones[Math.floor(n / 100)] + ' Hundred ';
          n %= 100;
        }
        if (n > 19) {
          str += tens[Math.floor(n / 10)] + ' ';
          n %= 10;
        }
        if (n > 0) {
          str += ones[n] + ' ';
        }
        return str.trim();
      }

      function getRupeesInWords(amount: number): string {
        if (amount === 0) return 'Zero';

        let result = '';
        const crore = Math.floor(amount / 10000000);
        amount %= 10000000;
        const lakh = Math.floor(amount / 100000);
        amount %= 100000;
        const thousand = Math.floor(amount / 1000);
        amount %= 1000;
        const hundred = amount;

        if (crore > 0) {
          result += convertGroup(crore) + ' Crore ';
        }
        if (lakh > 0) {
          result += convertGroup(lakh) + ' Lakh ';
        }
        if (thousand > 0) {
          result += convertGroup(thousand) + ' Thousand ';
        }
        if (hundred > 0) {
          result += convertGroup(hundred);
        }

        return result.trim();
      }

      const rupeesWords = getRupeesInWords(Math.floor(rupees));
      if (paise === 0) {
        return `${rupeesWords} Rupees Only`;
      } else {
        const paiseWords = convertGroup(Math.floor(paise));
        return `${rupeesWords} Rupees and ${paiseWords} Paise Only`;
      }
    }

    it('matches legacy output across 2,000+ sampled values below 100 crore', () => {
      const fixedValues = [
        0, 1, 99, 100, 101, 999, 1000, 99999, 100000, 9999999, 10000000, 999999999
      ];
      for (const rupees of fixedValues) {
        for (const paise of [0, 1, 50, 99]) {
          expect(amountInWordsIndian(rupees, paise)).toBe(legacyAmountInWordsIndian(rupees, paise));
        }
      }

      const prng = mulberry32(4242);
      for (let i = 0; i < 2000; i++) {
        // Values strictly below 100 crore (< 1,000,000,000)
        const rupees = randomInt(prng, 0, 999_999_999);
        const paise = randomInt(prng, 0, 99);
        expect(amountInWordsIndian(rupees, paise)).toBe(legacyAmountInWordsIndian(rupees, paise));
      }
    });
  });
});
