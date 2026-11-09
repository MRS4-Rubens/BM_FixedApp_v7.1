import { getIstDateParts } from './ist-date';

/** Default period is the current IST month and year. */
export function defaultListPeriod(now?: Date): { month: number; year: number } {
  const current = getIstDateParts(now || new Date());
  return {
    month: current.month,
    year: current.year,
  };
}

