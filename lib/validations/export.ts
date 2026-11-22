import { z } from 'zod';
import { EXPORT_LABEL_MAX_LENGTH } from '@/lib/validations/limits';
import { checkReportRange, reportRangeShape } from '@/lib/validations/report-range';

const EXPORT_REPORT_TYPES = ['sales_register', 'gstr1', 'itr_report', 'hsn_summary'] as const;
export type ExportReportType = (typeof EXPORT_REPORT_TYPES)[number];

// BUG-02: the date rule is shared with the Reports page and its actions (lib/validations/report-range.ts).
const exportRangeShape = {
  ...reportRangeShape,
  label: z
    .string()
    .trim()
    .min(1, 'Label is required')
    .max(EXPORT_LABEL_MAX_LENGTH, `Label cannot exceed ${EXPORT_LABEL_MAX_LENGTH} characters`)
    .regex(/^[A-Za-z0-9 _/-]+$/, 'Label contains invalid characters'),
};

export const exportRangeSchema = z.object(exportRangeShape).superRefine(checkReportRange);
export const exportQuerySchema = z
  .object({ ...exportRangeShape, type: z.enum(EXPORT_REPORT_TYPES).default('sales_register') })
  .superRefine(checkReportRange);
