/**
 * PERF-002b regression guard for the streamed Excel exports.
 *
 * When the builders moved from the in-memory ExcelJS.Workbook to the streaming WorkbookWriter,
 * the old and new builders were compared cell by cell on these fixtures and matched exactly
 * (see the PR that introduced this file). The old builders' output was recorded in
 * __snapshots__/xlsx-golden/*.json and the old code was then deleted. This test keeps every
 * report byte-for-byte equal in data to that record: sheet names, frozen panes, merges,
 * column widths, row heights, cell values, number formats and styling.
 *
 * The GSTR-1 layout is the statutory GSTN offline-utility format CAs upload to the GST portal.
 * If a snapshot changes, the report a CA receives has changed: only update it on purpose.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dumpWorkbook, loadWorkbook, writeToBuffer } from '@/tests/helpers/xlsx-dump';
import type { XlsxWriter } from '@/lib/excel/streaming-workbook';
import {
  gstr1Fixture,
  itrAnnualFixture,
  itrDefaultRatesFixture,
  itrMonthlyFixture,
  salesRegisterFixture,
} from '@/tests/fixtures/excel-report-fixtures';
import { writeGstr1Workbook } from '@/lib/excel/build-gstr1-report';
import { writeHsnWorkbook } from '@/lib/excel/build-hsn-report';
import { writeSalesRegisterWorkbook } from '@/lib/excel/build-sales-register';
import { writeItrReportWorkbook } from '@/lib/excel/build-itr-report';

beforeAll(() => {
  // "Generated on" cells print today's date: pin it to the day the golden files were recorded.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T10:00:00+05:30'));
});

afterAll(() => {
  vi.useRealTimers();
});

async function expectGolden(snapshot: string, write: XlsxWriter) {
  const dump = dumpWorkbook(await loadWorkbook(await writeToBuffer(write)));
  expect(dump.flatMap((sheet) => sheet.cells).length).toBeGreaterThan(0);
  await expect(JSON.stringify(dump, null, 1)).toMatchFileSnapshot(`__snapshots__/xlsx-golden/${snapshot}.json`);
}

describe('PERF-002b streamed Excel exports match the recorded pre-streaming output', () => {
  it('GSTR-1 workbook', async () => {
    await expectGolden('gstr1', (s) => writeGstr1Workbook(gstr1Fixture, s));
  });

  it('HSN summary workbook', async () => {
    await expectGolden('hsn', (s) => writeHsnWorkbook(gstr1Fixture, s));
  });

  it('Sales Register workbook', async () => {
    await expectGolden('sales-register', (s) => writeSalesRegisterWorkbook(salesRegisterFixture, s));
  });

  it.each([
    ['monthly', itrMonthlyFixture],
    ['annual (month-wise + 44AD sheets)', itrAnnualFixture],
    ['default rate slabs', itrDefaultRatesFixture],
  ])('ITR report workbook - %s', async (label, fixture) => {
    await expectGolden(`itr-${label.split(' ')[0]}`, (s) => writeItrReportWorkbook(fixture, s));
  });

  it('empty reports (no data rows)', async () => {
    const emptyGstr1 = { ...gstr1Fixture, b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], hsn: [], docs: [] };
    await expectGolden('gstr1-empty', (s) => writeGstr1Workbook(emptyGstr1, s));
    await expectGolden('hsn-empty', (s) => writeHsnWorkbook(emptyGstr1, s));
    const emptyRegister = { ...salesRegisterFixture, invoices: [], creditNotes: [], hsnSummary: [] };
    await expectGolden('sales-register-empty', (s) => writeSalesRegisterWorkbook(emptyRegister, s));
  });

  it('keeps the title block in row 1 when the column header row is further down', async () => {
    const name = gstr1Fixture.business.legal_name;
    const hsn = await loadWorkbook(await writeToBuffer((s) => writeHsnWorkbook(gstr1Fixture, s)));
    expect(hsn.getWorksheet('HSN Summary')?.getCell('A1').value).toBe(name);
    expect(hsn.getWorksheet('HSN Summary')?.getCell('G1').value).toBeNull();

    const register = await loadWorkbook(await writeToBuffer((s) => writeSalesRegisterWorkbook(salesRegisterFixture, s)));
    for (const sheetName of ['Sales Register', 'HSN Summary', 'Credit Notes']) {
      const sheet = register.getWorksheet(sheetName);
      expect(sheet?.getCell('A1').value, sheetName).toBe(salesRegisterFixture.business.legal_name);
      expect(sheet?.getCell('A6').value, sheetName).toBe(sheetName === 'HSN Summary' ? 'HSN/SAC Code' : 'S.No');
    }

    const itr = await loadWorkbook(await writeToBuffer((s) => writeItrReportWorkbook(itrAnnualFixture, s)));
    const schedule = itr.getWorksheet('Month-wise ITR Schedule');
    expect(String(schedule?.getCell('A1').value)).toContain(itrAnnualFixture.business.legal_name);
    expect(schedule?.getCell('A2').value).toBe('Month');
  });

  it('renders SGST/UTGST headers in Sales Register, HSN Summary, and GSTR-1', async () => {
    const register = await loadWorkbook(await writeToBuffer((s) => writeSalesRegisterWorkbook(salesRegisterFixture, s)));
    expect(register.getWorksheet('Sales Register')?.getCell('J6').value).toBe('SGST/UTGST');
    expect(register.getWorksheet('HSN Summary')?.getCell('G6').value).toBe('SGST/UTGST');
    expect(register.getWorksheet('Credit Notes')?.getCell('G6').value).toBe('SGST/UTGST');
    expect(register.getWorksheet('Summary')?.getCell('A7').value).toBe('Total SGST/UTGST');

    const hsn = await loadWorkbook(await writeToBuffer((s) => writeHsnWorkbook(gstr1Fixture, s)));
    expect(hsn.getWorksheet('HSN Summary')?.getCell('I6').value).toBe('SGST/UTGST (₹)');

    const gstr1 = await loadWorkbook(await writeToBuffer((s) => writeGstr1Workbook(gstr1Fixture, s)));
    expect(gstr1.getWorksheet('GSTR-1 Summary')?.getCell('A15').value).toBe('State/UT Tax (SGST/UTGST)');
  });

  it('streams a 2,000+ row sheet (crosses a yield boundary) without losing or reordering rows', async () => {
    const many = {
      ...gstr1Fixture,
      b2b: Array.from({ length: 4_500 }, (_, i) => ({ ...gstr1Fixture.b2b[0], invoiceNumber: `INV-${i}` })),
    };
    const workbook = await loadWorkbook(await writeToBuffer((s) => writeGstr1Workbook(many, s)));
    const sheet = workbook.getWorksheet('b2b');
    expect(sheet?.rowCount).toBe(4_501);
    expect(sheet?.getCell('C2').value).toBe('INV-0');
    expect(sheet?.getCell('C2001').value).toBe('INV-1999');
    expect(sheet?.getCell('C4501').value).toBe('INV-4499');
  });
});
