import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxStreamResponse } from '@/lib/excel/xlsx-response';

describe('xlsxStreamResponse (PERF-002)', () => {
  it('streams a workbook with status 200, correct headers, and valid PK zip structure', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Summary');
    sheet.getCell('A1').value = 'Bill Matrix Statutory Export Test';
    sheet.getCell('B1').value = 42000;

    const fileName = 'Test-Export-2026.xlsx';
    const response = xlsxStreamResponse(workbook, fileName);

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

  it('destroys the stream and logs an error when workbook.xlsx.write rejects', async () => {
    const brokenWorkbook = {
      xlsx: {
        write: vi.fn().mockRejectedValue(new Error('Serialization failure')),
      },
    } as unknown as ExcelJS.Workbook;

    const response = xlsxStreamResponse(brokenWorkbook, 'error.xlsx');
    expect(response.status).toBe(200);

    // Reading the response body stream should reject with the error
    await expect(response.arrayBuffer()).rejects.toThrow('Serialization failure');
  });
});

