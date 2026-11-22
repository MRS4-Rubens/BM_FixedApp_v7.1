import { z } from 'zod';
import { isoDate } from '@/lib/validations/common';
import { reportRangeMessage, reportRangeProblem } from '@/lib/reports/date-range';

/** BUG-02: the start/end fields every report and export input shares (real calendar dates, years 2017–2100). */
export const reportRangeShape = { startDate: isoDate, endDate: isoDate };

/** Adds the order and maximum-length checks (lib/reports/date-range.ts) once both dates are valid. */
export function checkReportRange(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx): void {
  const problem = reportRangeProblem(value.startDate, value.endDate);
  if (problem === 'end_before_start' || problem === 'too_long') {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: reportRangeMessage(problem) });
  }
}

export const reportRangeSchema = z.object(reportRangeShape).superRefine(checkReportRange);
