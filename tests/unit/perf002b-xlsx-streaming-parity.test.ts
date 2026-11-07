/**
 * PERF-002b parity proof: the streaming WorkbookWriter builders produce the same workbook
 * contents as the old in-memory ExcelJS.Workbook builders (kept under tests/fixtures/legacy-excel
 * only for this comparison). Every sheet is compared cell by cell: names, frozen panes, merges,
 * column widths, row heights, values, number formats and styling.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type ExcelJS from 'exceljs';
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
import { buildGstr1Workbook as legacyGstr1 } from '@/tests/fixtures/legacy-excel/build-gstr1-report';
import { buildHsnWorkbook as legacyHsn } from '@/tests/fixtures/legacy-excel/build-hsn-report';
import { buildSalesRegisterWorkbook as legacySalesRegister } from '@/tests/fixtures/legacy-excel/build-sales-register';
import { buildItrReportWorkbook as legacyItr } from '@/tests/fixtures/legacy-excel/build-itr-report';

beforeAll(() => {
  // "Generated on" cells print today's date: pin it so both builders print the same day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T10:00:00+05:30'));
});

afterAll(() => {
  vi.useRealTimers();
});

async function legacyDump(build: () => Promise<ExcelJS.Workbook>) {
  const workbook = await build();
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return dumpWorkbook(await loadWorkbook(buffer));
}

async function streamedDump(write: XlsxWriter) {
  return dumpWorkbook(await loadWorkbook(await writeToBuffer(write)));
}

async function expectParity(snapshot: string, build: () => Promise<ExcelJS.Workbook>, write: XlsxWriter) {
  const [before, after] = await Promise.all([legacyDump(build), streamedDump(write)]);
  // Golden record of what the old builder produced, kept after the old builder is deleted.
  await expect(JSON.stringify(before, null, 1)).toMatchFileSnapshot(`__snapshots__/xlsx-golden/${snapshot}.json`);
  expect(after.map((s) => s.name)).toEqual(before.map((s) => s.name));
  for (let i = 0; i < before.length; i++) {
    expect(after[i], `sheet "${before[i].name}"`).toEqual(before[i]);
  }
  expect(before.flatMap((s) => s.cells).length).toBeGreaterThan(0);
}

describe('PERF-002b streaming export parity with the old in-memory builders', () => {
  it('GSTR-1 workbook', async () => {
    await expectParity('gstr1', () => legacyGstr1(gstr1Fixture), (s) => writeGstr1Workbook(gstr1Fixture, s));
  });

  it('HSN summary workbook', async () => {
    await expectParity('hsn', () => legacyHsn(gstr1Fixture), (s) => writeHsnWorkbook(gstr1Fixture, s));
  });

  it('Sales Register workbook', async () => {
    await expectParity('sales-register', () => legacySalesRegister(salesRegisterFixture), (s) => writeSalesRegisterWorkbook(salesRegisterFixture, s));
  });

  it.each([
    ['monthly', itrMonthlyFixture],
    ['annual (month-wise + 44AD sheets)', itrAnnualFixture],
    ['default rate slabs', itrDefaultRatesFixture],
  ])('ITR report workbook - %s', async (label, fixture) => {
    await expectParity(`itr-${label.split(' ')[0]}`, () => legacyItr(fixture), (s) => writeItrReportWorkbook(fixture, s));
  });

  it('handles empty reports (no data rows) the same way', async () => {
    const emptyGstr1 = { ...gstr1Fixture, b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], hsn: [], docs: [] };
    await expectParity('gstr1-empty', () => legacyGstr1(emptyGstr1), (s) => writeGstr1Workbook(emptyGstr1, s));
    await expectParity('hsn-empty', () => legacyHsn(emptyGstr1), (s) => writeHsnWorkbook(emptyGstr1, s));
    const emptyRegister = { ...salesRegisterFixture, invoices: [], creditNotes: [], hsnSummary: [] };
    await expectParity('sales-register-empty', () => legacySalesRegister(emptyRegister), (s) => writeSalesRegisterWorkbook(emptyRegister, s));
  });
});
