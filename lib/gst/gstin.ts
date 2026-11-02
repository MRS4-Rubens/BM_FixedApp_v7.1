const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTN mod-36 check character for the first 14 characters; null if any character is outside 0-9A-Z. */
export function computeGstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = GSTIN_CHARSET.indexOf(first14.charAt(index));
    if (value < 0) return null;
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET.charAt((36 - (sum % 36)) % 36);
}

export function isValidGstinChecksum(gstin: string): boolean {
  return gstin.length === 15 && computeGstinCheckChar(gstin.slice(0, 14)) === gstin.charAt(14);
}
