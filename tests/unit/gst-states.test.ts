import { describe, expect, it } from 'vitest';
import {
  INDIAN_GST_STATES,
  STATE_CODE_TO_ABBR,
  getStateAbbrByCode,
  isValidStateCode,
} from '@/lib/gst/indian-states';

describe('Indian GST States & UTs Reference Data (TEST-001)', () => {
  it('SPEC: all codes are unique, exactly two digits (01-38), and names are non-empty and trimmed', () => {
    const codes = new Set<string>();

    for (const state of INDIAN_GST_STATES) {
      expect(state.code).toMatch(/^\d{2}$/);
      expect(codes.has(state.code)).toBe(false);
      codes.add(state.code);

      expect(state.name.length).toBeGreaterThan(0);
      expect(state.name.trim()).toBe(state.name);
    }

    expect(INDIAN_GST_STATES.length).toBe(36);
  });

  it('SPEC: STATE_CODE_TO_ABBR covers exactly the same set of codes as INDIAN_GST_STATES without orphans or gaps', () => {
    const stateCodes = new Set(INDIAN_GST_STATES.map((s) => s.code));
    const abbrCodes = new Set(Object.keys(STATE_CODE_TO_ABBR));

    expect(stateCodes).toEqual(abbrCodes);

    for (const [code, abbr] of Object.entries(STATE_CODE_TO_ABBR)) {
      expect(code).toMatch(/^\d{2}$/);
      expect(abbr).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('SPEC: key anchors match statutory definitions', () => {
    const find = (c: string) => INDIAN_GST_STATES.find((s) => s.code === c);

    expect(find('27')?.name).toBe('Maharashtra');
    expect(STATE_CODE_TO_ABBR['27']).toBe('MH');

    expect(find('07')?.name).toBe('Delhi');
    expect(STATE_CODE_TO_ABBR['07']).toBe('DL');

    expect(find('29')?.name).toBe('Karnataka');
    expect(STATE_CODE_TO_ABBR['29']).toBe('KA');

    expect(find('36')?.name).toBe('Telangana');
    expect(STATE_CODE_TO_ABBR['36']).toBe('TS');

    expect(find('37')?.name).toBe('Andhra Pradesh');
    expect(STATE_CODE_TO_ABBR['37']).toBe('AP');

    expect(find('38')?.name).toBe('Ladakh');
    expect(STATE_CODE_TO_ABBR['38']).toBe('LA');
  });

  it('SPEC: permanently discontinued codes 25 and 28 are absent', () => {
    const codes = new Set<string>(INDIAN_GST_STATES.map((s) => s.code));
    expect(codes.has('25')).toBe(false);
    expect(codes.has('28')).toBe(false);
    expect(STATE_CODE_TO_ABBR['25']).toBeUndefined();
    expect(STATE_CODE_TO_ABBR['28']).toBeUndefined();
  });

  describe('getStateAbbrByCode', () => {
    it('returns em-dash for falsy values', () => {
      expect(getStateAbbrByCode(null)).toBe('—');
      expect(getStateAbbrByCode(undefined)).toBe('—');
      expect(getStateAbbrByCode('')).toBe('—');
    });

    it('returns abbreviation for known state codes', () => {
      expect(getStateAbbrByCode('27')).toBe('MH');
      expect(getStateAbbrByCode('29')).toBe('KA');
    });

    it('returns original code as fallback for unknown non-empty codes', () => {
      expect(getStateAbbrByCode('99')).toBe('99');
      expect(getStateAbbrByCode('ZZ')).toBe('ZZ');
    });
  });

  describe('isValidStateCode', () => {
    it('returns true for all registered state codes', () => {
      for (const s of INDIAN_GST_STATES) {
        expect(isValidStateCode(s.code)).toBe(true);
      }
    });

    it('returns false for null, undefined, invalid, and discontinued codes', () => {
      expect(isValidStateCode(null)).toBe(false);
      expect(isValidStateCode(undefined)).toBe(false);
      expect(isValidStateCode('')).toBe(false);
      expect(isValidStateCode('25')).toBe(false);
      expect(isValidStateCode('28')).toBe(false);
      expect(isValidStateCode('99')).toBe(false);
      expect(isValidStateCode('XX')).toBe(false);
    });
  });
});
