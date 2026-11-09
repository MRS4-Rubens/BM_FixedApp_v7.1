import { z } from 'zod';
import { isoDate } from '@/lib/validations/common';
import { EXPORT_LABEL_MAX_LENGTH, EXPORT_MAX_RANGE_DAYS } from '@/lib/validations/limits';

const EXPORT_REPORT_TYPES = ['sales_register', 'gstr1', 'itr_report', 'hsn_summary'] as const;
export type ExportReportType = (typeof EXPORT_REPORT_TYPES)[number];

const MS_PER_DAY = 86_400_000;
const exportRangeShape = {
  startDate: isoDate,
  endDate: isoDate,
  label: z
    .string()
    .trim()
    .min(1, 'Label is required')
    .max(EXPORT_LABEL_MAX_LENGTH, `Label cannot exceed ${EXPORT_LABEL_MAX_LENGTH} characters`)
    .regex(/^[A-Za-z0-9 _/-]+$/, 'Label contains invalid characters'),
};

function checkRange(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx): void {
  const start = Date.parse(`${value.startDate}T00:00:00Z`);
  const end = Date.parse(`${value.endDate}T00:00:00Z`);
  if (end < start) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date cannot be before start date' });
  } else if ((end - start) / MS_PER_DAY + 1 > EXPORT_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: `Date range cannot exceed ${EXPORT_MAX_RANGE_DAYS} days`,
    });
  }
}

export const exportRangeSchema = z.object(exportRangeShape).superRefine(checkRange);
export const exportQuerySchema = z
  .object({ ...exportRangeShape, type: z.enum(EXPORT_REPORT_TYPES).default('sales_register') })
  .superRefine(checkRange);
