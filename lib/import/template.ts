import ExcelJS from 'exceljs';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { UNIT_OF_MEASUREMENT_OPTIONS } from '@/lib/gst/units';
import { CUSTOMER_COLUMNS, IMPORT_MAX_ROWS, PRODUCT_COLUMNS, type ImportColumn, type ImportKind } from '@/lib/import/columns';

/**
 * Feature D: the downloadable import template. Sheet 1 = data (header + 2 example rows to overwrite),
 * sheet 2 = instructions (every column, plus allowed units / GST rates / state codes). Every data cell is
 * formatted as TEXT so Excel keeps leading zeros (state "09", pincodes) and never turns a GSTIN into a number.
 */
function addDataSheet<Key extends string>(workbook: ExcelJS.Workbook, title: string, columns: readonly ImportColumn<Key>[]): void {
  const sheet = workbook.addWorksheet(title);
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: Math.max(14, column.header.length + 4), style: { numFmt: '@' } }));
  sheet.getRow(1).font = { bold: true };
  for (const exampleIndex of [0, 1] as const) {
    sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, column.example[exampleIndex]])));
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addInstructions<Key extends string>(
  workbook: ExcelJS.Workbook,
  columns: readonly ImportColumn<Key>[],
  extra: readonly (readonly [string, string])[],
): void {
  const sheet = workbook.addWorksheet('Instructions');
  sheet.columns = [
    { header: 'Column', key: 'column', width: 22 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'What to enter', key: 'help', width: 90 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const column of columns) {
    sheet.addRow({ column: column.header, required: column.required ? 'Yes' : 'No', help: column.help });
  }
  sheet.addRow({});
  sheet.addRow({ column: 'Before you upload', help: `Replace the 2 example rows with your data. Up to ${IMPORT_MAX_ROWS} rows and 2 MB per file. Keep the header row.` });
  for (const [label, value] of extra) {
    sheet.addRow({ column: label, help: value });
  }
}

export async function buildImportTemplate(kind: ImportKind, gstRatePercents: readonly string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Invoice BizFolio';
  if (kind === 'customers') {
    addDataSheet(workbook, 'Customers', CUSTOMER_COLUMNS);
    addInstructions(workbook, CUSTOMER_COLUMNS, [
      ['State codes', INDIAN_GST_STATES.map((state) => `${state.code} = ${state.name}`).join('; ')],
      ['Duplicates', 'A customer whose GSTIN is already in your account is skipped, not changed.'],
    ]);
  } else {
    addDataSheet(workbook, 'Products', PRODUCT_COLUMNS);
    addInstructions(workbook, PRODUCT_COLUMNS, [
      ['Allowed units', `${UNIT_OF_MEASUREMENT_OPTIONS.join(', ')} (Nos, Pcs, Kg, Litre, Dozen, Pair and similar spellings are also accepted)`],
      ['Allowed GST rates', gstRatePercents.length > 0 ? gstRatePercents.map((rate) => `${Number(rate)}%`).join(', ') : 'See the GST rate list in the product form.'],
      ['Duplicates', 'A product whose name is already in your catalogue is skipped, not changed.'],
    ]);
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
