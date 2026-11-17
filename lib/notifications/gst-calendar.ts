import type { GstFilingFrequency } from '@/lib/db/domain-values';
import { monthLong, monthShort } from './dates';

/**
 * Feature C: the NORMAL statutory due dates of GSTR-1 and GSTR-3B.
 * Government extensions for a particular month are NOT known here (approved limitation: reminders show the normal date).
 *
 * Monthly filers: GSTR-1 on the 11th and GSTR-3B on the 20th of the following month.
 * Quarterly (QRMP) filers: GSTR-1 on the 13th of the month after the quarter; GSTR-3B on the 22nd for the
 * "Category X" states/UTs below and on the 24th everywhere else.
 */

/** QRMP GSTR-3B is due on the 22nd for these state codes, and on the 24th for all others. */
const GSTR3B_QUARTERLY_22ND_STATE_CODES: ReadonlySet<string> = new Set([
  '22', // Chhattisgarh
  '23', // Madhya Pradesh
  '24', // Gujarat
  '25', // Daman and Diu (legacy code)
  '26', // Dadra and Nagar Haveli and Daman and Diu
  '27', // Maharashtra
  '29', // Karnataka
  '30', // Goa
  '31', // Lakshadweep
  '32', // Kerala
  '33', // Tamil Nadu
  '34', // Puducherry
  '35', // Andaman and Nicobar Islands
  '36', // Telangana
  '37', // Andhra Pradesh
]);

export function gstr3bQuarterlyDueDay(stateCode: string): 22 | 24 {
  return GSTR3B_QUARTERLY_22ND_STATE_CODES.has(stateCode) ? 22 : 24;
}

export interface GstDueItem {
  readonly returnName: 'GSTR-1' | 'GSTR-3B';
  /** "October 2026" or "Jul–Sep 2026" */
  readonly periodLabel: string;
  /** Stable de-duplication key: "2026-10" (month) or "2026-Q3" (calendar quarter ending in month 9). */
  readonly periodKey: string;
  readonly dueDateIso: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The returns whose normal due date is exactly `dateIso` for a business with this frequency and state. */
export function gstReturnsDueOn(
  dateIso: string,
  frequency: GstFilingFrequency | null,
  stateCode: string,
): GstDueItem[] {
  if (frequency !== 'monthly' && frequency !== 'quarterly') return [];
  const [year, month, day] = dateIso.split('-').map(Number);
  // The period is the previous month (monthly) or the calendar quarter that just ended (quarterly).
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  if (frequency === 'monthly') {
    const periodLabel = `${monthLong(prevMonth)} ${prevYear}`;
    const periodKey = `${prevYear}-${pad(prevMonth)}`;
    if (day === 11) return [{ returnName: 'GSTR-1', periodLabel, periodKey, dueDateIso: dateIso }];
    if (day === 20) return [{ returnName: 'GSTR-3B', periodLabel, periodKey, dueDateIso: dateIso }];
    return [];
  }

  // Quarterly: only in the month right after a quarter ends (January, April, July, October).
  if (month !== 1 && month !== 4 && month !== 7 && month !== 10) return [];
  const quarterEndMonth = prevMonth; // 12, 3, 6 or 9
  const periodLabel = `${monthShort(quarterEndMonth - 2)}–${monthShort(quarterEndMonth)} ${prevYear}`;
  const periodKey = `${prevYear}-Q${quarterEndMonth / 3}`;
  if (day === 13) return [{ returnName: 'GSTR-1', periodLabel, periodKey, dueDateIso: dateIso }];
  if (day === gstr3bQuarterlyDueDay(stateCode)) {
    return [{ returnName: 'GSTR-3B', periodLabel, periodKey, dueDateIso: dateIso }];
  }
  return [];
}
