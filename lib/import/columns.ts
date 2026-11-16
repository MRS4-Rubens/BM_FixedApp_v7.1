/**
 * Feature D (bulk import): the template columns. CLIENT-SAFE (no imports), so the upload screen can show the same
 * help text the template and the checker use.
 *
 * Header matching ignores case, spaces and punctuation, and accepts the listed aliases, so "GST Rate (%)",
 * "gst rate" and "GST%" all map to the same column. Column order does not matter.
 */
export const IMPORT_KINDS = ['customers', 'products'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export interface ImportColumn<Key extends string> {
  readonly key: Key;
  readonly header: string;
  readonly required: boolean;
  readonly aliases: readonly string[];
  readonly help: string;
  readonly example: readonly [string, string];
}

export type CustomerColumnKey =
  | 'name'
  | 'gstin'
  | 'email'
  | 'phone'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state'
  | 'pincode';

export type ProductColumnKey = 'name' | 'description' | 'hsn_sac_code' | 'unit' | 'price' | 'gst_rate' | 'stock';

export const CUSTOMER_COLUMNS: readonly ImportColumn<CustomerColumnKey>[] = [
  { key: 'name', header: 'Name', required: true, aliases: ['customer name', 'customer', 'party name', 'party'], help: 'Customer or business name (up to 200 characters).', example: ['Sharma Traders', 'Ravi Kumar'] },
  { key: 'gstin', header: 'GSTIN', required: false, aliases: ['gst number', 'gst no', 'gstin number', 'gstin/uin'], help: '15-character GSTIN. Leave blank for unregistered customers.', example: ['29ABCDE1234F1ZW', ''] },
  { key: 'email', header: 'Email', required: false, aliases: ['e-mail', 'email address', 'mail'], help: 'Optional e-mail address.', example: ['accounts@sharmatraders.in', ''] },
  { key: 'phone', header: 'Phone', required: false, aliases: ['mobile', 'phone number', 'mobile number', 'contact'], help: 'Optional phone number (up to 15 characters).', example: ['9876543210', '9123456780'] },
  { key: 'address_line1', header: 'Address line 1', required: false, aliases: ['address', 'address 1', 'address1', 'street'], help: 'Optional.', example: ['12 MG Road', ''] },
  { key: 'address_line2', header: 'Address line 2', required: false, aliases: ['address 2', 'address2', 'area', 'locality'], help: 'Optional.', example: ['Near City Mall', ''] },
  { key: 'city', header: 'City', required: false, aliases: ['town', 'district'], help: 'Optional.', example: ['Bengaluru', 'Mysuru'] },
  { key: 'state', header: 'State', required: false, aliases: ['state name', 'state code', 'place of supply'], help: 'State name or 2-digit GST state code. Can be left blank when a GSTIN is given (taken from the GSTIN).', example: ['', 'Karnataka'] },
  { key: 'pincode', header: 'Pincode', required: false, aliases: ['pin', 'pin code', 'postal code', 'zip'], help: 'Optional 6-digit pincode.', example: ['560001', '570001'] },
];

export const PRODUCT_COLUMNS: readonly ImportColumn<ProductColumnKey>[] = [
  { key: 'name', header: 'Name', required: true, aliases: ['product name', 'product', 'item name', 'item'], help: 'Product or service name (up to 200 characters).', example: ['Cotton Shirt', 'Repair Service'] },
  { key: 'description', header: 'Description', required: false, aliases: ['details'], help: 'Optional (up to 1000 characters).', example: ['100% cotton, half sleeves', ''] },
  { key: 'hsn_sac_code', header: 'HSN/SAC code', required: true, aliases: ['hsn', 'hsn code', 'sac', 'sac code', 'hsn/sac'], help: '4, 6 or 8 digits.', example: ['6205', '998714'] },
  { key: 'unit', header: 'Unit', required: false, aliases: ['uom', 'unit of measurement', 'units'], help: 'One of the units listed below. Leave blank for PCS.', example: ['PCS', 'NOS'] },
  { key: 'price', header: 'Sale price (Rs)', required: true, aliases: ['sale price', 'price', 'rate', 'selling price', 'mrp', 'sale price (₹)', 'price (rs)'], help: 'Price in rupees, up to 2 decimal places.', example: ['499', '1250.50'] },
  { key: 'gst_rate', header: 'GST rate (%)', required: false, aliases: ['gst rate', 'gst', 'gst %', 'tax rate', 'gst percent'], help: 'One of the GST rates listed below, e.g. 18. Leave blank to choose on each invoice.', example: ['5', '18'] },
  { key: 'stock', header: 'Opening stock', required: false, aliases: ['stock', 'quantity', 'qty', 'opening qty'], help: 'Optional whole number.', example: ['100', ''] },
];

/** "GST Rate (%)" -> "gstrate". Shared by template and checker so headers always round-trip. */
export function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
