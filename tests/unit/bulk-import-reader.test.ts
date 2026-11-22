import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, CUSTOMER_COLUMNS, PRODUCT_COLUMNS } from '@/lib/import/columns';
import { inspectZip, MAX_ZIP_UNCOMPRESSED_BYTES, parseCsv, readImportFile } from '@/lib/import/read-file';
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

  // SVC-03: the uncompressed cap protects the 512 MB server without refusing any real file.
  const fill = (text: string, length: number) => text.repeat(Math.ceil(length / text.length)).slice(0, length);

  it(
    `accepts ${IMPORT_MAX_ROWS} rows with every column at its maximum length in Indian-language text`,
    async () => {
      expect(MAX_ZIP_UNCOMPRESSED_BYTES).toBe(8 * 1024 * 1024);
      // Every long cell is unique per row (identical text would be stored only once and understate the size).
      const hindi = 'शर्मा ट्रेडर्स उत्पाद विवरण ';
      const products = await xlsxBase64([
        PRODUCT_COLUMNS.map((column) => column.header),
        ...Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => [
          `${i} ${fill(hindi, 190)}`, `${i} ${fill(hindi, 990)}`, '62059090', 'PCS', '1250000.50', '18', '9999999',
        ]),
      ]);
      const customers = await xlsxBase64([
        CUSTOMER_COLUMNS.map((column) => column.header),
        ...Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => [
          `${i} ${fill(hindi, 190)}`, '29ABCDE1234F1ZW', `${fill('accounts', 240)}${i}@shop.in`, '+91987654321012',
          `${i} ${fill(hindi, 290)}`, `${i} ${fill(hindi, 290)}`, `${i} ${fill(hindi, 90)}`, 'Karnataka', '560001',
        ]),
      ]);
      for (const base64 of [products, customers]) {
        const zip = inspectZip(Buffer.from(base64, 'base64'));
        expect(zip).not.toBeNull();
        expect(zip?.uncompressedBytes ?? Infinity).toBeLessThan(MAX_ZIP_UNCOMPRESSED_BYTES * 0.75);
        const result = await readImportFile({ fileName: 'max.xlsx', base64 });
        expect(result.ok ? result.rows.length : result.code).toBe(IMPORT_MAX_ROWS);
      }
    },
    60_000,
  );

  it(
    'refuses a small upload that would unpack to more than 8 MB, before ExcelJS reads it (30 MB was allowed before)',
    async () => {
      // ~9 MB of sheet XML that compresses to a few KB: valid, under the 2 MB upload limit and the row limit.
      const base64 = await xlsxBase64([
        ['Name', 'Description'],
        // Each text unique: identical strings are stored once in the shared-strings part.
        ...Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => [`Item ${i}`, `${i} ${'x'.repeat(9_500)}`]),
      ]);
      const bytes = Buffer.from(base64, 'base64');
      expect(bytes.length).toBeLessThan(IMPORT_MAX_BYTES);
      const result = await readImportFile({ fileName: 'big.xlsx', base64 });
      expect(result.ok ? 'OK' : result.code).toBe('UNSAFE_FILE');
    },
    60_000,
  );
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
