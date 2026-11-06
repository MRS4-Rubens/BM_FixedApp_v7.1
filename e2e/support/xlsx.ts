import ExcelJS from 'exceljs';

export interface B2bRow {
  readonly recipientGstin: string;
  readonly receiverName: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly invoiceValuePaise: number;
  readonly ratePercentage: number;
  readonly taxableValuePaise: number;
}

export interface CdnrRow {
  readonly recipientGstin: string;
  readonly receiverName: string;
  readonly noteNumber: string;
  readonly noteDate: string;
  readonly noteValuePaise: number;
  readonly ratePercentage: number;
  readonly taxableValuePaise: number;
}

export interface ParsedGstr1 {
  readonly b2b: readonly B2bRow[];
  readonly cdnr: readonly CdnrRow[];
}

function cellValueToPaise(val: ExcelJS.CellValue): number {
  if (typeof val === 'number') {
    return Math.round(val * 100);
  }
  if (typeof val === 'string') {
    const num = parseFloat(val.replace(/,/g, ''));
    if (!Number.isNaN(num)) return Math.round(num * 100);
  }
  return 0;
}

function cellValueToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

export async function parseGstr1Workbook(buffer: Buffer): Promise<ParsedGstr1> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS accepts Uint8Array or ArrayBuffer; Buffer is a Uint8Array
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const b2bSheet = workbook.getWorksheet('b2b');
  const b2bRows: B2bRow[] = [];

  if (b2bSheet) {
    b2bSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const gstin = cellValueToString(row.getCell(1).value);
      const name = cellValueToString(row.getCell(2).value);
      const invNo = cellValueToString(row.getCell(3).value);
      const invDate = cellValueToString(row.getCell(4).value);
      const invValPaise = cellValueToPaise(row.getCell(5).value);
      const rate = Number(row.getCell(11).value) || 0;
      const taxablePaise = cellValueToPaise(row.getCell(12).value);

      if (invNo) {
        b2bRows.push({
          recipientGstin: gstin,
          receiverName: name,
          invoiceNumber: invNo,
          invoiceDate: invDate,
          invoiceValuePaise: invValPaise,
          ratePercentage: rate,
          taxableValuePaise: taxablePaise,
        });
      }
    });
  }

  const cdnrSheet = workbook.getWorksheet('cdnr');
  const cdnrRows: CdnrRow[] = [];

  if (cdnrSheet) {
    cdnrSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const gstin = cellValueToString(row.getCell(1).value);
      const name = cellValueToString(row.getCell(2).value);
      const noteNo = cellValueToString(row.getCell(3).value);
      const noteDate = cellValueToString(row.getCell(4).value);
      const noteValPaise = cellValueToPaise(row.getCell(9).value);
      const rate = Number(row.getCell(11).value) || 0;
      const taxablePaise = cellValueToPaise(row.getCell(12).value);

      if (noteNo) {
        cdnrRows.push({
          recipientGstin: gstin,
          receiverName: name,
          noteNumber: noteNo,
          noteDate: noteDate,
          noteValuePaise: noteValPaise,
          ratePercentage: rate,
          taxableValuePaise: taxablePaise,
        });
      }
    });
  }

  return {
    b2b: b2bRows,
    cdnr: cdnrRows,
  };
}

