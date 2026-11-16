import type { z } from 'zod';
import { customerSchema } from '@/lib/validations/customer';
import { productSchema } from '@/lib/validations/product';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { UNIT_OF_MEASUREMENT_OPTIONS } from '@/lib/gst/units';
import { rupeesToPaise } from '@/lib/money';
import {
  CUSTOMER_COLUMNS,
  PRODUCT_COLUMNS,
  normaliseHeader,
  type CustomerColumnKey,
  type ImportColumn,
  type ProductColumnKey,
} from '@/lib/import/columns';
import type { SheetRow } from '@/lib/import/read-file';

/**
 * Feature D: row-by-row checks. PURE (no database): callers pass what already exists in the account.
 * Every row runs through the SAME zod schema the single-record forms use, so an imported customer/product can
 * never be something the normal form would refuse.
 */

export interface RowIssue {
  readonly column: string; // header label shown to the user, or '' for a whole-row issue
  readonly message: string;
}

export type RowStatus = 'ready' | 'duplicate' | 'error';

export interface CheckedRow<Insert> {
  readonly rowNumber: number;
  readonly label: string; // the row's name, for the preview table
  readonly status: RowStatus;
  readonly issues: readonly RowIssue[];
  /** Present only when status === 'ready'. */
  readonly value?: Insert;
}

export type HeaderMap<Key extends string> =
  | { readonly ok: true; readonly indexOf: ReadonlyMap<Key, number> }
  | { readonly ok: false; readonly message: string };

export function mapHeaders<Key extends string>(header: readonly string[], columns: readonly ImportColumn<Key>[]): HeaderMap<Key> {
  const indexOf = new Map<Key, number>();
  const seen = new Map<Key, string>();
  header.forEach((cell, index) => {
    const normalised = normaliseHeader(cell);
    if (normalised === '') return;
    const column = columns.find(
      (candidate) =>
        normaliseHeader(candidate.header) === normalised ||
        candidate.aliases.some((alias) => normaliseHeader(alias) === normalised),
    );
    if (!column) return; // unknown extra columns are ignored
    if (!seen.has(column.key)) {
      seen.set(column.key, cell);
      indexOf.set(column.key, index);
    }
  });
  const missing = columns.filter((column) => column.required && !indexOf.has(column.key)).map((column) => column.header);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the downloadable template.`,
    };
  }
  return { ok: true, indexOf };
}

function cellOf<Key extends string>(row: SheetRow, indexOf: ReadonlyMap<Key, number>, key: Key): string {
  const index = indexOf.get(key);
  return index === undefined ? '' : (row.cells[index] ?? '').trim();
}

function issuesFromZod<Key extends string>(
  error: z.ZodError,
  columns: readonly ImportColumn<Key>[],
  fieldToKey: Readonly<Record<string, Key>>,
): RowIssue[] {
  return error.issues.map((issue) => {
    const field = String(issue.path[0] ?? '');
    const key = fieldToKey[field];
    const column = key ? columns.find((candidate) => candidate.key === key) : undefined;
    return { column: column?.header ?? '', message: issue.message };
  });
}

// ───────────────────────────── customers ─────────────────────────────

export interface CustomerInsert {
  readonly name: string;
  readonly gstin: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly city: string | null;
  readonly state_code: string;
  readonly pincode: string | null;
}

/** "29", "9", "Karnataka", "karnataka " -> "29"; unknown -> null. */
export function resolveStateCode(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d{1,2}$/.test(trimmed)) {
    const code = trimmed.padStart(2, '0');
    return INDIAN_GST_STATES.some((state) => state.code === code) ? code : null;
  }
  const wanted = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return INDIAN_GST_STATES.find((state) => state.name.toLowerCase() === wanted)?.code ?? null;
}

const CUSTOMER_FIELD_TO_KEY: Readonly<Record<string, CustomerColumnKey>> = {
  name: 'name',
  gstin: 'gstin',
  email: 'email',
  phone: 'phone',
  address_line1: 'address_line1',
  address_line2: 'address_line2',
  city: 'city',
  state_code: 'state',
  pincode: 'pincode',
};

export function checkCustomerRows(
  rows: readonly SheetRow[],
  indexOf: ReadonlyMap<CustomerColumnKey, number>,
  existingGstins: ReadonlySet<string>,
  /** Name keys (see customerNameKey) of customers WITHOUT a GSTIN already in the account. */
  existingUnregisteredNames: ReadonlySet<string> = new Set(),
): CheckedRow<CustomerInsert>[] {
  const firstRowForGstin = new Map<string, number>();
  const firstRowForUnregisteredName = new Map<string, number>();
  return rows.map((row) => {
    const get = (key: CustomerColumnKey) => cellOf(row, indexOf, key);
    const name = get('name');
    const gstinRaw = get('gstin').toUpperCase().replace(/\s+/g, '');
    const stateRaw = get('state');
    const issues: RowIssue[] = [];

    let stateCode = resolveStateCode(stateRaw);
    if (stateRaw !== '' && stateCode === null) {
      issues.push({ column: 'State', message: `"${stateRaw}" is not an Indian state name or 2-digit GST state code.` });
    }
    if (stateRaw === '' && gstinRaw.length >= 2) {
      stateCode = resolveStateCode(gstinRaw.slice(0, 2));
    }
    if (stateRaw === '' && gstinRaw === '') {
      issues.push({ column: 'State', message: 'State is required when there is no GSTIN.' });
    }

    const parsed = customerSchema.safeParse({
      name,
      gstin: gstinRaw,
      email: get('email'),
      phone: get('phone'),
      address_line1: get('address_line1'),
      address_line2: get('address_line2'),
      city: get('city'),
      state_code: stateCode ?? '',
      pincode: get('pincode'),
    });
    if (!parsed.success) {
      // State problems were already explained above in plain words; skip zod's duplicate state messages.
      issues.push(
        ...issuesFromZod(parsed.error, CUSTOMER_COLUMNS, CUSTOMER_FIELD_TO_KEY).filter(
          (issue) => !(issue.column === 'State' && issues.some((existing) => existing.column === 'State')),
        ),
      );
    }

    const label = name || `Row ${row.rowNumber}`;
    if (issues.length > 0 || !parsed.success) {
      return { rowNumber: row.rowNumber, label, status: 'error', issues };
    }

    const gstin = parsed.data.gstin ? parsed.data.gstin : null;
    if (gstin) {
      const firstRow = firstRowForGstin.get(gstin);
      if (firstRow !== undefined) {
        return {
          rowNumber: row.rowNumber,
          label,
          status: 'error',
          issues: [{ column: 'GSTIN', message: `Same GSTIN as row ${firstRow} in this file.` }],
        };
      }
      firstRowForGstin.set(gstin, row.rowNumber);
      if (existingGstins.has(gstin)) {
        return {
          rowNumber: row.rowNumber,
          label,
          status: 'duplicate',
          issues: [{ column: 'GSTIN', message: 'A customer with this GSTIN already exists. It will be skipped.' }],
        };
      }
    }

    if (!gstin) {
      // Unregistered customers have no GSTIN to match on, so the name decides (ignoring case and spaces).
      const nameKey = customerNameKey(parsed.data.name);
      const firstRow = firstRowForUnregisteredName.get(nameKey);
      if (firstRow !== undefined) {
        return {
          rowNumber: row.rowNumber,
          label,
          status: 'error',
          issues: [{ column: 'Name', message: `Same customer name (without GSTIN) as row ${firstRow} in this file.` }],
        };
      }
      firstRowForUnregisteredName.set(nameKey, row.rowNumber);
      if (existingUnregisteredNames.has(nameKey)) {
        return {
          rowNumber: row.rowNumber,
          label,
          status: 'duplicate',
          issues: [{ column: 'Name', message: 'A customer with this name (and no GSTIN) already exists. It will be skipped.' }],
        };
      }
    }

    return {
      rowNumber: row.rowNumber,
      label,
      status: 'ready',
      issues: [],
      value: {
        name: parsed.data.name,
        gstin,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        address_line1: parsed.data.address_line1 || null,
        address_line2: parsed.data.address_line2 || null,
        city: parsed.data.city || null,
        state_code: parsed.data.state_code,
        pincode: parsed.data.pincode || null,
      },
    };
  });
}

// ───────────────────────────── products ─────────────────────────────

export interface ProductInsert {
  readonly name: string;
  readonly description: string | null;
  readonly hsn_sac_code: string;
  readonly unit_of_measurement: (typeof UNIT_OF_MEASUREMENT_OPTIONS)[number];
  readonly default_sale_price_paise: number;
  readonly default_tax_rate_id: string | null;
  readonly stock_quantity: number | null;
}

const UNIT_ALIASES: Readonly<Record<string, (typeof UNIT_OF_MEASUREMENT_OPTIONS)[number]>> = {
  NOS: 'NOS', NO: 'NOS', NUMBER: 'NOS', NUMBERS: 'NOS', NUM: 'NOS',
  PCS: 'PCS', PC: 'PCS', PIECE: 'PCS', PIECES: 'PCS',
  KGS: 'KGS', KG: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS', KILO: 'KGS',
  LTR: 'LTR', L: 'LTR', LT: 'LTR', LITRE: 'LTR', LITRES: 'LTR', LITER: 'LTR', LITERS: 'LTR',
  MTR: 'MTR', M: 'MTR', METER: 'MTR', METERS: 'MTR', METRE: 'MTR', METRES: 'MTR',
  SQM: 'SQM', SQMTR: 'SQM', SQUAREMETER: 'SQM', SQUAREMETRE: 'SQM', SQUAREMETERS: 'SQM', SQUAREMETRES: 'SQM',
  SET: 'SET', SETS: 'SET',
  BOX: 'BOX', BOXES: 'BOX',
  PAC: 'PAC', PACK: 'PAC', PACKS: 'PAC', PKT: 'PAC', PACKET: 'PAC', PACKETS: 'PAC',
  PRS: 'PRS', PAIR: 'PRS', PAIRS: 'PRS',
  DOZ: 'DOZ', DOZEN: 'DOZ', DOZENS: 'DOZ', DZN: 'DOZ',
  OTH: 'OTH', OTHER: 'OTH', OTHERS: 'OTH',
};

/** "Nos", "pcs.", "Kilograms" -> canonical unit; blank -> 'PCS' (the product form's default); unknown -> null. */
export function resolveUnit(value: string): (typeof UNIT_OF_MEASUREMENT_OPTIONS)[number] | null {
  const key = value.toUpperCase().replace(/[^A-Z]/g, '');
  if (key === '') return 'PCS';
  return UNIT_ALIASES[key] ?? null;
}

/** "18", "18%", " 18.0 " -> "18.00" (the tax_rates.rate_percentage text form); not a number -> null. */
export function normaliseGstRate(value: string): string | null {
  const cleaned = value.replace(/%/g, '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned).toFixed(2);
}

/** Case- and space-insensitive customer name key (used only for customers without a GSTIN). */
export function customerNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Case- and space-insensitive product name key used for duplicate detection. */
export function productNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const PRODUCT_FIELD_TO_KEY: Readonly<Record<string, ProductColumnKey>> = {
  name: 'name',
  description: 'description',
  hsn_sac_code: 'hsn_sac_code',
  unit_of_measurement: 'unit',
  default_sale_price: 'price',
  default_tax_rate_id: 'gst_rate',
  stock_quantity: 'stock',
};

export function checkProductRows(
  rows: readonly SheetRow[],
  indexOf: ReadonlyMap<ProductColumnKey, number>,
  existingNameKeys: ReadonlySet<string>,
  taxRateIdByPercent: ReadonlyMap<string, string>,
): CheckedRow<ProductInsert>[] {
  const firstRowForName = new Map<string, number>();
  const knownRates = [...taxRateIdByPercent.keys()].map((rate) => String(Number(rate))).join(', ');
  return rows.map((row) => {
    const get = (key: ProductColumnKey) => cellOf(row, indexOf, key);
    const name = get('name');
    const unitRaw = get('unit');
    const priceRaw = get('price').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
    const rateRaw = get('gst_rate');
    const stockRaw = get('stock');
    const issues: RowIssue[] = [];

    const unit = resolveUnit(unitRaw);
    if (unit === null) {
      issues.push({ column: 'Unit', message: `"${unitRaw}" is not a known unit. Use one of: ${UNIT_OF_MEASUREMENT_OPTIONS.join(', ')}.` });
    }
    if (priceRaw === '') {
      issues.push({ column: 'Sale price (Rs)', message: 'Sale price is required.' });
    }
    let taxRateId = '';
    if (rateRaw !== '') {
      const percent = normaliseGstRate(rateRaw);
      const id = percent === null ? undefined : taxRateIdByPercent.get(percent);
      if (id === undefined) {
        issues.push({ column: 'GST rate (%)', message: `"${rateRaw}" is not a GST rate in the app. Use one of: ${knownRates}.` });
      } else {
        taxRateId = id;
      }
    }
    if (stockRaw !== '' && !/^\d+$/.test(stockRaw)) {
      issues.push({ column: 'Opening stock', message: 'Opening stock must be a whole number (or left blank).' });
    }

    const parsed = productSchema.safeParse({
      name,
      description: get('description'),
      hsn_sac_code: get('hsn_sac_code'),
      unit_of_measurement: unit ?? '',
      default_sale_price: priceRaw === '' ? 'missing' : priceRaw,
      default_tax_rate_id: taxRateId,
      stock_quantity: stockRaw,
    });
    if (!parsed.success) {
      const already = new Set(issues.map((issue) => issue.column));
      issues.push(
        ...issuesFromZod(parsed.error, PRODUCT_COLUMNS, PRODUCT_FIELD_TO_KEY).filter((issue) => !already.has(issue.column)),
      );
    }

    const label = name || `Row ${row.rowNumber}`;
    if (issues.length > 0 || !parsed.success) {
      return { rowNumber: row.rowNumber, label, status: 'error', issues };
    }

    const nameKey = productNameKey(parsed.data.name);
    const firstRow = firstRowForName.get(nameKey);
    if (firstRow !== undefined) {
      return {
        rowNumber: row.rowNumber,
        label,
        status: 'error',
        issues: [{ column: 'Name', message: `Same product name as row ${firstRow} in this file.` }],
      };
    }
    firstRowForName.set(nameKey, row.rowNumber);
    if (existingNameKeys.has(nameKey)) {
      return {
        rowNumber: row.rowNumber,
        label,
        status: 'duplicate',
        issues: [{ column: 'Name', message: 'A product with this name already exists. It will be skipped.' }],
      };
    }

    const stock = parsed.data.stock_quantity;
    return {
      rowNumber: row.rowNumber,
      label,
      status: 'ready',
      issues: [],
      value: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        hsn_sac_code: parsed.data.hsn_sac_code,
        unit_of_measurement: parsed.data.unit_of_measurement,
        default_sale_price_paise: rupeesToPaise(parsed.data.default_sale_price),
        default_tax_rate_id: parsed.data.default_tax_rate_id === '' ? null : (parsed.data.default_tax_rate_id ?? null),
        stock_quantity: stockRaw === '' || stock === '' || stock === undefined ? null : stock,
      },
    };
  });
}
