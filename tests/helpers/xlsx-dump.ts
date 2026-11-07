/**
 * Helpers for testing the streamed Excel exports (PERF-002b): capture a writer's output into
 * a Buffer, and turn any .xlsx Buffer into a plain, comparable description of its contents.
 */
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import type { XlsxWriter } from '@/lib/excel/streaming-workbook';

/** Runs a lib/excel writer and collects everything it streams into one Buffer. */
export async function writeToBuffer(write: XlsxWriter): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on('end', resolve);
    sink.on('error', reject);
  });
  await write(sink);
  await finished;
  return Buffer.concat(chunks);
}

/** Loads an .xlsx Buffer back into an ExcelJS workbook (the same way e2e/support/xlsx.ts does). */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

export interface CellDump {
  readonly address: string;
  readonly value: ExcelJS.CellValue;
  readonly numFmt: string | undefined;
  readonly font: Partial<ExcelJS.Font> | undefined;
  readonly fill: ExcelJS.Fill | undefined;
  readonly alignment: Partial<ExcelJS.Alignment> | undefined;
  readonly border: Partial<ExcelJS.Borders> | undefined;
}

export interface SheetDump {
  readonly name: string;
  readonly views: Partial<ExcelJS.WorksheetView>[];
  readonly merges: string[];
  readonly columnWidths: (number | undefined)[];
  readonly rowHeights: Record<number, number | undefined>;
  readonly cells: CellDump[];
}

/**
 * Describes every sheet: name, frozen panes, merged ranges, column widths, row heights and,
 * for every cell that has a value, its value, number format and styling. Two workbooks with
 * equal dumps show the same data, laid out the same way.
 */
export function dumpWorkbook(workbook: ExcelJS.Workbook): SheetDump[] {
  return workbook.worksheets.map((sheet) => {
    const cells: CellDump[] = [];
    const rowHeights: Record<number, number | undefined> = {};
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      rowHeights[rowNumber] = row.height;
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells.push({
          address: cell.address,
          value: cell.value,
          numFmt: cell.numFmt,
          font: cell.font,
          fill: cell.fill,
          alignment: cell.alignment,
          border: cell.border,
        });
      });
    });
    const merges = [...(sheet.model.merges ?? [])].sort();
    return {
      name: sheet.name,
      views: (sheet.views ?? []).map((view) => {
        const { state, xSplit, ySplit } = view as ExcelJS.WorksheetViewFrozen;
        return { state, xSplit, ySplit };
      }),
      merges,
      columnWidths: (sheet.columns ?? []).map((column) => column.width),
      rowHeights,
      cells,
    };
  });
}
