import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_ROWS, CUSTOMER_COLUMNS, PRODUCT_COLUMNS } from '@/lib/import/columns';
import { inspectZip, parseCsv, readImportFile } from '@/lib/import/read-file';
import { buildImportTemplate } from '@/lib/import/template';
import { mapHeaders } from '@/lib/import/validate-rows';

/** Feature D: the file reader must be strict about what it opens and how much it reads. */

async function xlsxBase64(rows: (string | number)[][]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** A tiny well-formed zip whose ONE central-directory entry claims 100 MB uncompressed (a zip-bomb marker). */
function zipBombHeader(): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(100 * 1024 * 1024, 24); // declared uncompressed size
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿Name,Address line 1\r\n"Sharma, Traders","12 ""MG"" Road\nFloor 2"\r\nRavi,\n';
    expect(parseCsv(text, 10)).toEqual({
      rows: [
        ['Name', 'Address line 1'],
        ['Sharma, Traders', '12 "MG" Road\nFloor 2'],
        ['Ravi', ''],
      ],
      truncated: false,
    });
  });

  it('stops as soon as the row limit is passed', () => {
    const text = Array.from({ length: 50 }, (_, i) => `row${i}`).join('\n');
    const parsed = parseCsv(text, 5);
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows.length).toBe(6);
  });
});

describe('inspectZip (zip-bomb guard)', () => {
  it('accepts a real .xlsx and refuses a zip that declares 100 MB inside', async () => {
    const real = Buffer.from(await xlsxBase64([['Name'], ['A']]), 'base64');
    expect(inspectZip(real)).not.toBeNull();
    expect(inspectZip(zipBombHeader())).toBeNull();
    expect(inspectZip(Buffer.from('PK\u0003\u0004 not really a zip'))).toBeNull();
  });
});

describe('readImportFile', () => {
  it('reads an .xlsx sheet as trimmed text with real Excel row numbers, skipping blank rows', async () => {
    const result = await readImportFile({
      fileName: 'Customers.XLSX',
      base64: await xlsxBase64([['Name', 'Pincode'], [' Sharma Traders ', 560001], [], ['Ravi', '570001']]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toEqual(['Name', 'Pincode']);
    expect(result.rows).toEqual([
      { rowNumber: 2, cells: ['Sharma Traders', '560001'] },
      { rowNumber: 4, cells: ['Ravi', '570001'] },
    ]);
  });

  it('reads a UTF-8 .csv', async () => {
    const result = await readImportFile({ fileName: 'list.csv', base64: b64('Name,City\nRavi,Mysuru\n') });
    expect(result.ok && result.rows).toEqual([{ rowNumber: 2, cells: ['Ravi', 'Mysuru'] }]);
  });

  it('refuses wrong types, disguised files, bad base64, empty and oversized files', async () => {
    const xlsx = await xlsxBase64([['Name'], ['A']]);
    const code = async (fileName: string, base64: string) => {
      const result = await readImportFile({ fileName, base64 });
      return result.ok ? 'OK' : result.code;
    };
    expect(await code('list.xls', xlsx)).toBe('UNSUPPORTED_FILE');
    expect(await code('list.pdf', b64('Name\nA'))).toBe('UNSUPPORTED_FILE');
    expect(await code('list.csv', xlsx)).toBe('UNSUPPORTED_FILE'); // zip renamed to .csv
    expect(await code('list.xlsx', b64('Name\nA'))).toBe('UNSUPPORTED_FILE'); // text renamed to .xlsx
    expect(await code('list.xlsx', zipBombHeader().toString('base64'))).toBe('UNSAFE_FILE');
    expect(await code('list.csv', '%%%not-base64%%%')).toBe('EMPTY_FILE');
    expect(await code('list.csv', b64('Name\n'))).toBe('NO_DATA');
    expect(await code('list.csv', 'A'.repeat(3_000_000))).toBe('FILE_TOO_LARGE');
    expect(await code('list.csv', Buffer.from([0x4e, 0x00, 0x41]).toString('base64'))).toBe('UNSUPPORTED_FILE');
  });

  it(`allows exactly ${IMPORT_MAX_ROWS} data rows and refuses ${IMPORT_MAX_ROWS + 1} (CSV and Excel)`, async () => {
    const csv = (n: number) => b64(['Name', ...Array.from({ length: n }, (_, i) => `Customer ${i}`)].join('\n'));
    expect((await readImportFile({ fileName: 'a.csv', base64: csv(IMPORT_MAX_ROWS) })).ok).toBe(true);
    const over = await readImportFile({ fileName: 'a.csv', base64: csv(IMPORT_MAX_ROWS + 1) });
    expect(over.ok ? 'OK' : over.code).toBe('TOO_MANY_ROWS');

    const xlsx = await xlsxBase64([['Name'], ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => [`C${i}`])]);
    const overX = await readImportFile({ fileName: 'a.xlsx', base64: xlsx });
    expect(overX.ok ? 'OK' : overX.code).toBe('TOO_MANY_ROWS');
  });
});

describe('downloadable template round-trips through the reader', () => {
  it.each([
    ['customers', CUSTOMER_COLUMNS],
    ['products', PRODUCT_COLUMNS],
  ] as const)('%s template: data sheet first, headers map, 2 example rows', async (kind, columns) => {
    const file = await buildImportTemplate(kind, ['5.00', '18.00']);
    const result = await readImportFile({ fileName: `${kind}.xlsx`, base64: file.toString('base64') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toEqual(columns.map((column) => column.header));
    expect(result.rows).toHaveLength(2);
    expect(mapHeaders(result.header, columns).ok).toBe(true);
  });
});
