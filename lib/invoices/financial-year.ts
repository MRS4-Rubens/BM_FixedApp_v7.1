import { getIstDateParts } from './ist-date';

export function getIndianFinancialYearForDate(date: Date): { label: string; startDate: Date; endDate: Date } {
  const { year, month } = getIstDateParts(date); // month is 1-12 here, NOT 0-indexed
  const startYear = month >= 4 ? year : year - 1; // April = month 4 in this 1-indexed scheme
  const endYear = startYear + 1;
  const startDate = new Date(Date.UTC(startYear, 3, 1));
  const endDate = new Date(Date.UTC(endYear, 2, 31));
  const label = `${startYear}-${String(endYear).slice(-2)}`;
  return { label, startDate, endDate };
}

// This is the single source of truth for Indian financial-year boundaries. Phase 9 (invoice numbering rollover) will import and reuse this exact function rather than redefining it — do not duplicate this logic elsewhere.

/** DB-008: the current FY is a pure function of today's IST date; it is never stored. */
export function getCurrentFinancialYearLabel(now: Date = new Date()): string {
  return getIndianFinancialYearForDate(now).label;
}

/** Accepts stored labels with or without a leading "FY " (e.g. "2026-27" or "FY 2026-27"). */
export function isCurrentFinancialYearLabel(label: string, now: Date = new Date()): boolean {
  const normalize = (value: string): string => value.trim().replace(/^FY\s*/i, '');
  return normalize(label) === normalize(getCurrentFinancialYearLabel(now));
}

