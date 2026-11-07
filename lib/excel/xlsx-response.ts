import { PassThrough, Readable } from 'node:stream';
import type ExcelJS from 'exceljs';
import { logError } from '@/lib/actions/_shared/logger';

/**
 * Streams an ExcelJS workbook directly to the HTTP response using Node PassThrough and Readable.toWeb,
 * avoiding full in-memory buffer materialization before headers are sent (PERF-002).
 */
export function xlsxStreamResponse(workbook: ExcelJS.Workbook, fileName: string): Response {
  const passThrough = new PassThrough();

  workbook.xlsx.write(passThrough).catch((error: unknown) => {
    logError('xlsx-stream-export', error, { fileName });
    passThrough.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return new Response(Readable.toWeb(passThrough) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

