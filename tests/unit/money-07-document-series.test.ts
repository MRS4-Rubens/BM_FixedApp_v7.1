import { describe, expect, it } from 'vitest';
import { groupDocumentSeries } from '@/lib/reports/document-series';

/** MONEY-07: GSTR-1 Table 13 rows, one per document series, "from"/"to" by counter. */
const docs = (...numbers: string[]) => numbers.map((number) => ({ number, cancelled: false }));

describe('groupDocumentSeries', () => {
  it('yearly series: one row, ordered by counter even when a back-dated invoice comes first by date', () => {
    // Sorted by invoice date as the export query returns them: 0003 was back-dated before 0001 and 0002.
    expect(groupDocumentSeries(docs('INV/26-27/0003', 'INV/26-27/0001', 'INV/26-27/0002'), 'INV/{FY}/{SEQ:4}')).toEqual([
      { from: 'INV/26-27/0001', to: 'INV/26-27/0003', total: 3, cancelled: 0 },
    ]);
  });

  it('monthly reset: one row per month', () => {
    expect(
      groupDocumentSeries(docs('INV/2611/001', 'INV/2611/002', 'INV/2612/001', 'INV/2612/002', 'INV/2612/003'), 'INV/{YY}{MM}/{SEQ:3}'),
    ).toEqual([
      { from: 'INV/2611/001', to: 'INV/2611/002', total: 2, cancelled: 0 },
      { from: 'INV/2612/001', to: 'INV/2612/003', total: 3, cancelled: 0 },
    ]);
  });

  it('the default daily format: one row per day', () => {
    expect(
      groupDocumentSeries(docs('INV-01/11/26/001', 'INV-01/11/26/002', 'INV-02/11/26/001'), 'INV-{DD}/{MM}/{YY}/{SEQ:3}'),
    ).toEqual([
      { from: 'INV-01/11/26/001', to: 'INV-01/11/26/002', total: 2, cancelled: 0 },
      { from: 'INV-02/11/26/001', to: 'INV-02/11/26/001', total: 1, cancelled: 0 },
    ]);
  });

  it('a counter that outgrew its width still sorts as a number (999 before 1000)', () => {
    expect(groupDocumentSeries(docs('A/26-27/1000', 'A/26-27/999'), 'A/{FY}/{SEQ:3}')).toEqual([
      { from: 'A/26-27/999', to: 'A/26-27/1000', total: 2, cancelled: 0 },
    ]);
  });

  it('uses the format to find a counter that is NOT the last number in the text', () => {
    expect(groupDocumentSeries(docs('002/INV/26-27', '001/INV/26-27'), '{SEQ:3}/INV/{FY}')).toEqual([
      { from: '001/INV/26-27', to: '002/INV/26-27', total: 2, cancelled: 0 },
    ]);
  });

  it('after a format change, older numbers form their own series (last digits = counter)', () => {
    expect(groupDocumentSeries(docs('INV/26-27/0041', 'INV/26-27/0042', 'BM/26-27/0001'), 'BM/{FY}/{SEQ:4}')).toEqual([
      { from: 'BM/26-27/0001', to: 'BM/26-27/0001', total: 1, cancelled: 0 },
      { from: 'INV/26-27/0041', to: 'INV/26-27/0042', total: 2, cancelled: 0 },
    ]);
  });

  it('credit notes: cancelled ones are counted per series; a changed prefix starts a new series', () => {
    expect(
      groupDocumentSeries([
        { number: 'CN/26-27/002', cancelled: true },
        { number: 'CN/26-27/001', cancelled: false },
        { number: 'CN/26-27/003', cancelled: false },
        { number: 'CRN/26-27/001', cancelled: false },
      ]),
    ).toEqual([
      { from: 'CN/26-27/001', to: 'CN/26-27/003', total: 3, cancelled: 1 },
      { from: 'CRN/26-27/001', to: 'CRN/26-27/001', total: 1, cancelled: 0 },
    ]);
  });

  it('no documents, no rows; an unparsable format falls back safely', () => {
    expect(groupDocumentSeries([], 'INV/{FY}/{SEQ:4}')).toEqual([]);
    expect(groupDocumentSeries(docs('X/26-27/0002', 'X/26-27/0001'), '{BAD')).toEqual([
      { from: 'X/26-27/0001', to: 'X/26-27/0002', total: 2, cancelled: 0 },
    ]);
  });
});
