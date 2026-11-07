import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';

/**
 * A function that writes one complete .xlsx file into `stream` and resolves once the
 * workbook has been committed (PERF-002b). Every report builder in lib/excel has this shape.
 */
export type XlsxWriter = (stream: Writable) => Promise<void>;

/**
 * Creates an ExcelJS streaming WorkbookWriter that writes the zipped .xlsx straight into
 * `stream` instead of holding the whole workbook model in memory.
 *
 * - `useStyles: true` keeps fonts, fills, borders and number formats (they are part of the
 *   report layout CAs rely on).
 * - `zip.zlib.level: 6` matches the old writer's compression, so downloads stay the same size.
 * - `useSharedStrings: true` keeps text cells in xl/sharedStrings.xml exactly like the old
 *   in-memory `Workbook.xlsx.write()` did, so the file stays structurally the same for the
 *   GSTN offline utility and Excel.
 *
 * Rows must be written top-down: once `row.commit()` (or `worksheet.commit()`) has run, that
 * row and everything above it are flushed and can no longer be read or changed.
 */
export function createStreamingWorkbook(stream: Writable): ExcelJS.stream.xlsx.WorkbookWriter {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: true,
    // Same DEFLATE level the old in-memory writer (JSZip) used. ExcelJS's streaming default is
    // weaker and made a 100k-line GSTR-1 file ~25% larger for no memory benefit.
    zip: { zlib: { level: 6 } },
  });
  workbook.creator = 'Bill Matrix';
  workbook.created = new Date();
  return workbook;
}

/** How many data rows are written between pauses that let the zip encoder drain to the client. */
export const ROWS_PER_YIELD = 2000;

/**
 * Gives the event loop a turn so archiver can compress and flush the rows committed so far.
 * Without this, a synchronous loop over 100k rows would queue all of the sheet XML in memory
 * before a single byte reached the HTTP response.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Commits `row` and, every ROWS_PER_YIELD rows, yields so buffered output can be flushed.
 * `index` is the zero-based position of the row within the data being written.
 */
export async function commitDataRow(row: ExcelJS.Row, index: number): Promise<void> {
  row.commit();
  if ((index + 1) % ROWS_PER_YIELD === 0) {
    await yieldToEventLoop();
  }
}

/**
 * Column definitions without their `header` text, for sheets whose header row is NOT row 1.
 * ExcelJS writes every column `header` into row 1 when `sheet.columns` is set, which would
 * overwrite a title block (business name, GSTIN) that sits above the real header row.
 * Use this when the header row is written explicitly further down the sheet.
 */
export function columnsWithoutHeaders(
  columns: readonly Partial<ExcelJS.Column>[],
): Partial<ExcelJS.Column>[] {
  return columns.map((column) => {
    const definition = { ...column };
    delete definition.header;
    return definition;
  });
}
