import ExcelJS from 'exceljs';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '@/lib/import/columns';

/**
 * Feature D: turns an uploaded .xlsx / .csv file into rows of trimmed text cells. SERVER-ONLY.
 *
 * Defences (checked in this order, cheapest first):
 *  - base64 shape and decoded size (IMPORT_MAX_BYTES) before anything is parsed;
 *  - file type from the CONTENT (zip magic for .xlsx, valid UTF-8 without NUL bytes for .csv), not just the name;
 *  - .xlsx is a zip: its central directory is read first and the file is refused if it declares too many entries
 *    or too much uncompressed data (zip bomb) or uses ZIP64, before ExcelJS inflates anything;
 *  - at most IMPORT_MAX_ROWS data rows; CSV parsing stops as soon as the limit is passed.
 * Cell values are read as their displayed text, so formulas contribute their cached result, never the formula.
 */
export interface SheetRow {
  /** 1-based row number as the user sees it in Excel (header row = 1). */
  readonly rowNumber: number;
  readonly cells: readonly string[];
}

export type ReadFileErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE'
  | 'UNSAFE_FILE'
  | 'TOO_MANY_ROWS'
  | 'NO_DATA'
  | 'UNREADABLE_FILE';

export type ReadFileResult =
  | { readonly ok: true; readonly header: readonly string[]; readonly rows: readonly SheetRow[] }
  | { readonly ok: false; readonly code: ReadFileErrorCode; readonly message: string };

const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function fail(code: ReadFileErrorCode, message: string): ReadFileResult {
  return { ok: false, code, message };
}

function decodeBase64File(base64: string): Buffer | null {
  const compact = base64.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64_PATTERN.test(compact)) return null;
  return Buffer.from(compact, 'base64');
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads the zip central directory WITHOUT inflating anything. Returns null when the archive is malformed,
 * uses ZIP64, or declares more than the allowed entries / uncompressed bytes.
 */
export function inspectZip(bytes: Buffer): { entries: number; uncompressedBytes: number } | null {
  const EOCD_SIGNATURE = 0x06054b50;
  const CDH_SIGNATURE = 0x02014b50;
  const searchStart = Math.max(0, bytes.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= searchStart; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null; // ZIP64
  if (entries > MAX_ZIP_ENTRIES) return null;
  if (directoryOffset + directorySize > bytes.length) return null;

  let offset = directoryOffset;
  let uncompressedBytes = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CDH_SIGNATURE) return null;
    const uncompressed = bytes.readUInt32LE(offset + 24);
    if (uncompressed === 0xffffffff) return null; // ZIP64 entry
    uncompressedBytes += uncompressed;
    if (uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) return null;
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, uncompressedBytes };
}

/** RFC 4180-style CSV: quoted fields, "" escapes, commas / CR / LF inside quotes. Stops after `maxRows` rows. */
export function parseCsv(text: string, maxRows: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endRow = (): boolean => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    return rows.length > maxRows;
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      if (endRow()) return { rows, truncated: true };
      i += ch === '\r' && input[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    if (endRow()) return { rows, truncated: true };
  }
  return { rows, truncated: false };
}

function toSheet(rawRows: readonly (readonly string[])[], rowNumbers?: readonly number[]): ReadFileResult {
  const indexed = rawRows.map((cells, index) => ({
    rowNumber: rowNumbers?.[index] ?? index + 1,
    cells: cells.map((cell) => cell.trim()),
  }));
  const nonEmpty = indexed.filter((row) => row.cells.some((cell) => cell !== ''));
  const [headerRow, ...dataRows] = nonEmpty;
  if (!headerRow) return fail('NO_DATA', 'The file has no header row. Use the downloadable template.');
  if (dataRows.length === 0) return fail('NO_DATA', 'The file has a header row but no data rows.');
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return fail('TOO_MANY_ROWS', `The file has more than ${IMPORT_MAX_ROWS} rows. Split it into smaller files.`);
  }
  return { ok: true, header: headerRow.cells, rows: dataRows };
}

async function readXlsx(bytes: Buffer): Promise<ReadFileResult> {
  if (inspectZip(bytes) === null) {
    return fail('UNSAFE_FILE', 'This Excel file could not be opened safely. Save it again as a normal .xlsx file and retry.');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS declares its own `Buffer extends ArrayBuffer`; give it a plain ArrayBuffer copy of the bytes (JSZip reads it).
    await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  } catch {
    return fail('UNREADABLE_FILE', 'This Excel file could not be read. Save it again as .xlsx (not .xls) and retry.');
  }
  const sheet = workbook.worksheets.find((candidate) => candidate.state !== 'hidden' && candidate.state !== 'veryHidden');
  if (!sheet) return fail('NO_DATA', 'The Excel file has no visible sheet.');
  // +1 for the header row, +1 so "exactly one too many" is still detected below.
  if (sheet.actualRowCount > IMPORT_MAX_ROWS + 2) {
    return fail('TOO_MANY_ROWS', `The file has more than ${IMPORT_MAX_ROWS} rows. Split it into smaller files.`);
  }
  const width = Math.min(sheet.actualColumnCount, 50);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let col = 1; col <= width; col += 1) {
      cells.push(row.getCell(col).text ?? '');
    }
    rows.push(cells);
    rowNumbers.push(rowNumber);
  });
  return toSheet(rows, rowNumbers);
}

function readCsv(bytes: Buffer): ReadFileResult {
  if (bytes.includes(0)) {
    return fail('UNSUPPORTED_FILE', 'This does not look like a CSV text file.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('UNSUPPORTED_FILE', 'The CSV file must be saved as UTF-8 text.');
  }
  const { rows, truncated } = parseCsv(text, IMPORT_MAX_ROWS + 2);
  if (truncated) {
    return fail('TOO_MANY_ROWS', `The file has more than ${IMPORT_MAX_ROWS} rows. Split it into smaller files.`);
  }
  return toSheet(rows);
}

export async function readImportFile(input: { fileName: string; base64: string }): Promise<ReadFileResult> {
  // Reject oversized payloads before decoding (base64 is 4/3 of the binary size).
  if (input.base64.length > Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 8) {
    return fail('FILE_TOO_LARGE', 'The file is larger than 2 MB. Split it into smaller files.');
  }
  const bytes = decodeBase64File(input.base64);
  if (bytes === null || bytes.length === 0) return fail('EMPTY_FILE', 'The file is empty or could not be read.');
  if (bytes.length > IMPORT_MAX_BYTES) return fail('FILE_TOO_LARGE', 'The file is larger than 2 MB. Split it into smaller files.');

  const name = input.fileName.toLowerCase();
  if (name.endsWith('.xlsx') && isZip(bytes)) return readXlsx(bytes);
  if (name.endsWith('.csv') && !isZip(bytes)) return readCsv(bytes);
  return fail('UNSUPPORTED_FILE', 'Upload the template as an Excel (.xlsx) or CSV (.csv) file.');
}
