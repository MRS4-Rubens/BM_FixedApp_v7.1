import { describe, expect, it } from 'vitest';
import { computeGstinCheckChar, isValidGstinChecksum } from '@/lib/gst/gstin';

describe('lib/gst/gstin Mod-36 Checksum', () => {
  const validGstins = [
    '29ABCDE1234F1ZW',
    '27AABCU9603R1ZN',
    '07AAAAA0000A1Z4',
    '33GSPTN0462P1ZU',
  ];

  it('validates known valid GSTINs', () => {
    for (const gstin of validGstins) {
      expect(isValidGstinChecksum(gstin)).toBe(true);
      const computedChar = computeGstinCheckChar(gstin.slice(0, 14));
      expect(computedChar).toBe(gstin.charAt(14));
    }
  });

  it('rejects lowercase GSTINs since charset is strictly uppercase 0-9A-Z', () => {
    for (const gstin of validGstins) {
      expect(isValidGstinChecksum(gstin.toLowerCase())).toBe(false);
    }
  });

  it('rejects GSTINs with altered checksum characters', () => {
    for (const gstin of validGstins) {
      const wrongChar = gstin.charAt(14) === 'A' ? 'B' : 'A';
      const altered = gstin.slice(0, 14) + wrongChar;
      expect(isValidGstinChecksum(altered)).toBe(false);
    }
  });

  it('rejects GSTINs with altered interior characters', () => {
    // 29ABCDE1234F1ZW -> change 5th char 'E' to 'F'
    expect(isValidGstinChecksum('29ABCDF1234F1ZW')).toBe(false);
    // 27AABCU9603R1ZN -> change '9' to '8'
    expect(isValidGstinChecksum('27AABCU8603R1ZN')).toBe(false);
  });

  it('rejects GSTINs with invalid length', () => {
    expect(isValidGstinChecksum('')).toBe(false);
    expect(isValidGstinChecksum('29ABCDE1234F1Z')).toBe(false); // 14 chars
    expect(isValidGstinChecksum('29ABCDE1234F1ZW5A')).toBe(false); // 16 chars
  });

  it('rejects strings with invalid characters or whitespaces', () => {
    expect(isValidGstinChecksum('29ABCDE1234F1Z!')).toBe(false);
    expect(isValidGstinChecksum(' 29ABCDE1234F1ZW ')).toBe(false);
    expect(isValidGstinChecksum('29-BCDE1234F1ZW')).toBe(false);
  });

  it('computeGstinCheckChar returns null for non-14 character inputs', () => {
    expect(computeGstinCheckChar('29ABCDE1234F1')).toBeNull();
    expect(computeGstinCheckChar('29ABCDE1234F1ZW')).toBeNull();
  });
});
