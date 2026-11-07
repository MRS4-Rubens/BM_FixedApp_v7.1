import { PassThrough, Readable } from 'node:stream';
import { logError } from '@/lib/actions/_shared/logger';
import type { XlsxWriter } from '@/lib/excel/streaming-workbook';

/**
 * Streams an .xlsx report straight into the HTTP response (PERF-002 / PERF-002b).
 *
 * `write` is one of the lib/excel report writers: it builds the workbook with ExcelJS's
 * streaming WorkbookWriter and commits rows into the PassThrough as it goes, so the full
 * workbook is never held in memory and the first bytes reach the browser while later rows are
 * still being produced. If writing fails part-way, the stream is destroyed so the client sees
 * a failed download instead of a truncated file that looks complete.
 */
export function xlsxStreamResponse(write: XlsxWriter, fileName: string): Response {
  const passThrough = new PassThrough();

  // Start on the next tick so a synchronous throw inside `write` still goes through the
  // error path below instead of escaping before the Response is returned.
  Promise.resolve()
    .then(() => write(passThrough))
    .catch((error: unknown) => {
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
