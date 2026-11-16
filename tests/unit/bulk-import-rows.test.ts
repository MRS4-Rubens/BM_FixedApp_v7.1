import { describe, expect, it } from 'vitest';
import { CUSTOMER_COLUMNS, PRODUCT_COLUMNS, type CustomerColumnKey, type ProductColumnKey } from '@/lib/import/columns';
import type { SheetRow } from '@/lib/import/read-file';
import {
  checkCustomerRows,
  checkProductRows,
  mapHeaders,
  normaliseGstRate,
  productNameKey,
  resolveStateCode,
  resolveUnit,
} from '@/lib/import/validate-rows';

/** Feature D: every imported row must pass the same rules as the single-record forms. */

const VALID_GSTIN = '29ABCDE1234F1ZW'; // checksum-valid, Karnataka
const OTHER_VALID_GSTIN = '27AAACR5055K1Z7'; // checksum-valid, Maharashtra

function rows(header: string[], data: string[][]): { header: string[]; rows: SheetRow[] } {
  return { header, rows: data.map((cells, i) => ({ rowNumber: i + 2, cells })) };
}

function customerMap(header: string[]): ReadonlyMap<CustomerColumnKey, number> {
  const mapped = mapHeaders(header, CUSTOMER_COLUMNS);
  if (!mapped.ok) throw new Error(mapped.message);
  return mapped.indexOf;
}

function productMap(header: string[]): ReadonlyMap<ProductColumnKey, number> {
  const mapped = mapHeaders(header, PRODUCT_COLUMNS);
  if (!mapped.ok) throw new Error(mapped.message);
  return mapped.indexOf;
}

describe('header mapping', () => {
  it('ignores case, spacing, punctuation and column order; accepts aliases; ignores unknown columns', () => {
    const mapped = mapHeaders(['  hsn ', 'Notes', 'PRODUCT NAME', 'GST %', 'Sale Price (₹)'], PRODUCT_COLUMNS);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.indexOf.get('hsn_sac_code')).toBe(0);
    expect(mapped.indexOf.get('name')).toBe(2);
    expect(mapped.indexOf.get('gst_rate')).toBe(3);
    expect(mapped.indexOf.get('price')).toBe(4);
  });

  it('names every missing required column', () => {
    const mapped = mapHeaders(['Name'], PRODUCT_COLUMNS);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.message).toContain('HSN/SAC code, Sale price (Rs)');
  });
});

describe('helpers', () => {
  it('states, units, GST rates and name keys', () => {
    expect(resolveStateCode('29')).toBe('29');
    expect(resolveStateCode('9')).toBe('09');
    expect(resolveStateCode(' karnataka ')).toBe('29');
    expect(resolveStateCode('Atlantis')).toBeNull();
    expect(resolveStateCode('99')).toBeNull();

    expect(resolveUnit('Nos')).toBe('NOS');
    expect(resolveUnit('pcs.')).toBe('PCS');
    expect(resolveUnit('Kilograms')).toBe('KGS');
    expect(resolveUnit('dozen')).toBe('DOZ');
    expect(resolveUnit('')).toBe('PCS');
    expect(resolveUnit('furlong')).toBeNull();

    expect(normaliseGstRate('18')).toBe('18.00');
    expect(normaliseGstRate(' 18% ')).toBe('18.00');
    expect(normaliseGstRate('0.25')).toBe('0.25');
    expect(normaliseGstRate('eighteen')).toBeNull();

    expect(productNameKey('  Cotton   SHIRT ')).toBe('cotton shirt');
  });
});

describe('customer rows', () => {
  const header = ['Name', 'GSTIN', 'Email', 'Phone', 'State', 'Pincode'];

  it('accepts a registered customer (state taken from the GSTIN) and an unregistered one with a state name', () => {
    const { rows: data } = rows(header, [
      ['Sharma Traders', VALID_GSTIN.toLowerCase(), 'a@b.in', '9876543210', '', '560001'],
      ['Ravi Kumar', '', '', '', 'Karnataka', ''],
    ]);
    const checked = checkCustomerRows(data, customerMap(header), new Set());
    expect(checked.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(checked[0]?.value).toMatchObject({ gstin: VALID_GSTIN, state_code: '29', email: 'a@b.in', pincode: '560001' });
    expect(checked[1]?.value).toMatchObject({ gstin: null, state_code: '29', email: null });
  });

  it('reports every problem on the row, by column', () => {
    const { rows: data } = rows(header, [
      ['', '29ABCDE1234F1Z5', 'not-an-email', '', '', '12'],
      ['No State', '', '', '', '', ''],
      ['Wrong State', OTHER_VALID_GSTIN, '', '', 'Karnataka', ''],
      ['Bad State', '', '', '', 'Atlantis', ''],
    ]);
    const checked = checkCustomerRows(data, customerMap(header), new Set());
    expect(checked.map((row) => row.status)).toEqual(['error', 'error', 'error', 'error']);
    const columns = (i: number) => checked[i]?.issues.map((issue) => issue.column).sort();
    expect(columns(0)).toEqual(expect.arrayContaining(['Name', 'GSTIN', 'Email', 'Pincode']));
    expect(checked[1]?.issues).toEqual([{ column: 'State', message: 'State is required when there is no GSTIN.' }]);
    expect(columns(2)).toContain('GSTIN'); // GSTIN state (27) does not match Karnataka (29)
    expect(checked[3]?.issues[0]?.message).toContain('"Atlantis" is not an Indian state');
  });

  it('skips GSTINs already in the account and flags the same GSTIN twice in one file', () => {
    const { rows: data } = rows(header, [
      ['First', VALID_GSTIN, '', '', '', ''],
      ['Second copy', VALID_GSTIN, '', '', '', ''],
      ['Already there', OTHER_VALID_GSTIN, '', '', '', ''],
    ]);
    const checked = checkCustomerRows(data, customerMap(header), new Set([OTHER_VALID_GSTIN]));
    expect(checked.map((row) => row.status)).toEqual(['ready', 'error', 'duplicate']);
    expect(checked[1]?.issues[0]?.message).toBe('Same GSTIN as row 2 in this file.');
  });
});

describe('product rows', () => {
  const header = ['Name', 'HSN/SAC code', 'Unit', 'Sale price (Rs)', 'GST rate (%)', 'Opening stock'];
  const rates = new Map([
    ['5.00', '00000000-0000-4000-8000-000000000005'],
    ['18.00', '00000000-0000-4000-8000-000000000018'],
  ]);

  it('maps unit aliases, rupee prices, GST % and stock', () => {
    const { rows: data } = rows(header, [
      ['Cotton Shirt', '6205', 'Nos', '₹1,250.50', '18%', '100'],
      ['Repair Service', '998714', '', '499', '', ''],
    ]);
    const checked = checkProductRows(data, productMap(header), new Set(), rates);
    expect(checked.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(checked[0]?.value).toEqual({
      name: 'Cotton Shirt',
      description: null,
      hsn_sac_code: '6205',
      unit_of_measurement: 'NOS',
      default_sale_price_paise: 125050,
      default_tax_rate_id: '00000000-0000-4000-8000-000000000018',
      stock_quantity: 100,
    });
    expect(checked[1]?.value).toMatchObject({ unit_of_measurement: 'PCS', default_tax_rate_id: null, stock_quantity: null });
  });

  it('a blank price is an error (never silently 0), and every bad field is named', () => {
    const { rows: data } = rows(header, [
      ['No Price', '6205', 'PCS', '', '18', ''],
      ['Bad Everything', '12', 'furlong', '-5', '7', '2.5'],
      ['Too precise', '6205', 'PCS', '10.123', '18', ''],
    ]);
    const checked = checkProductRows(data, productMap(header), new Set(), rates);
    expect(checked.map((row) => row.status)).toEqual(['error', 'error', 'error']);
    expect(checked[0]?.issues).toEqual([{ column: 'Sale price (Rs)', message: 'Sale price is required.' }]);
    const columns = checked[1]?.issues.map((issue) => issue.column) ?? [];
    expect(columns).toEqual(expect.arrayContaining(['HSN/SAC code', 'Unit', 'Sale price (Rs)', 'GST rate (%)', 'Opening stock']));
    expect(checked[1]?.issues.find((issue) => issue.column === 'GST rate (%)')?.message).toContain('Use one of: 5, 18');
    expect(checked[2]?.issues.map((issue) => issue.column)).toEqual(['Sale price (Rs)']);
  });

  it('skips names already in the catalogue (ignoring case and spaces) and flags repeats inside the file', () => {
    const { rows: data } = rows(header, [
      ['Cotton  shirt', '6205', 'PCS', '10', '', ''],
      ['Tea', '0902', 'KGS', '10', '5', ''],
      ['TEA', '0902', 'KGS', '12', '5', ''],
    ]);
    const checked = checkProductRows(data, productMap(header), new Set(['cotton shirt']), rates);
    expect(checked.map((row) => row.status)).toEqual(['duplicate', 'ready', 'error']);
    expect(checked[2]?.issues[0]?.message).toBe('Same product name as row 3 in this file.');
  });
});

describe('customer rows without a GSTIN', () => {
  const header = ['Name', 'GSTIN', 'State'];

  it('are matched by name (ignoring case and spaces): existing -> skipped, repeated in the file -> error', () => {
    const { rows: data } = rows(header, [
      ['Ravi  KUMAR', '', 'Karnataka'],
      ['New Person', '', 'Karnataka'],
      ['new person', '', 'Kerala'],
      ['Ravi Kumar', VALID_GSTIN, ''], // has a GSTIN: matched by GSTIN, not by name
    ]);
    const checked = checkCustomerRows(data, customerMap(header), new Set(), new Set(['ravi kumar']));
    expect(checked.map((row) => row.status)).toEqual(['duplicate', 'ready', 'error', 'ready']);
    expect(checked[2]?.issues[0]?.message).toBe('Same customer name (without GSTIN) as row 3 in this file.');
  });
});
