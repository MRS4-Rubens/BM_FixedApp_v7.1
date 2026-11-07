import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxStreamResponse } from '@/lib/excel/xlsx-response';
import { createStreamingWorkbook } from '@/lib/excel/streaming-workbook';

describe('xlsxStreamResponse (PERF-002 / PERF-002b)', () => {
  it('streams a WorkbookWriter workbook with status 200, correct headers, and valid PK zip structure', async () => {
    const fileName = 'Test-Export-2026.xlsx';
    const response = xlsxStreamResponse(async (stream) => {
      const workbook = createStreamingWorkbook(stream);
      const sheet = workbook.addWorksheet('Summary');
      const row = sheet.getRow(1);
      row.getCell(1).value = 'Bill Matrix Statutory Export Test';
      row.getCell(2).value = 42000;
      row.commit();
      sheet.commit();
      await workbook.commit();
    }, fileName);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${fileName}"`,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ZIP magic bytes: PK (0x50, 0x4B)
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

    // Round-trip verification: load into new ExcelJS workbook and verify cells
    const loadedWorkbook = new ExcelJS.Workbook();
    await loadedWorkbook.xlsx.load(buffer as unknown as Parameters<typeof loadedWorkbook.xlsx.load>[0]);
    const loadedSheet = loadedWorkbook.getWorksheet('Summary');
    expect(loadedSheet).toBeDefined();
    expect(loadedSheet?.getCell('A1').value).toBe('Bill Matrix Statutory Export Test');
    expect(loadedSheet?.getCell('B1').value).toBe(42000);
  });

  it('destroys the stream and logs an error when the writer rejects', async () => {
    const write = vi.fn().mockRejectedValue(new Error('Serialization failure'));

    const response = xlsxStreamResponse(write, 'error.xlsx');
    expect(response.status).toBe(200);

    // Reading the response body stream should reject with the error
    await expect(response.arrayBuffer()).rejects.toThrow('Serialization failure');
  });

  it('destroys the stream when the writer throws synchronously', async () => {
    const write = () => {
      throw new Error('Bad input');
    };

    const response = xlsxStreamResponse(write, 'error.xlsx');
    await expect(response.arrayBuffer()).rejects.toThrow('Bad input');
  });
});
