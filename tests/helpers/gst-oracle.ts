const ZERO = BigInt(0);
const TWO = BigInt(2);
const TEN_THOUSAND = BigInt(10000);
const TWENTY_THOUSAND = BigInt(20000);

/** Exact half-up rounding of n/d for n >= 0, d > 0. */
function roundHalfUp(n: bigint, d: bigint): bigint {
  return (TWO * n + d) / (TWO * d);
}

export interface OracleLineInput {
  readonly grossPaise: bigint;
  readonly discountPaise: bigint;
  readonly rateBp: bigint;
  readonly intraState: boolean;
}

export interface OracleLineResult {
  readonly taxable: bigint;
  readonly cgst: bigint;
  readonly sgst: bigint;
  readonly igst: bigint;
  readonly lineTotal: bigint;
}

export function oracleExclusive(i: OracleLineInput): OracleLineResult {
  const taxable = i.grossPaise - i.discountPaise;
  if (i.intraState) {
    const half = roundHalfUp(taxable * i.rateBp, TWENTY_THOUSAND); // taxable * (bp/2) / 10000
    return { taxable, cgst: half, sgst: half, igst: ZERO, lineTotal: taxable + TWO * half };
  }
  const igst = roundHalfUp(taxable * i.rateBp, TEN_THOUSAND);
  return { taxable, cgst: ZERO, sgst: ZERO, igst, lineTotal: taxable + igst };
}

export function oracleInclusive(i: OracleLineInput): OracleLineResult {
  const lineTotal = i.grossPaise - i.discountPaise;
  const taxableRaw = roundHalfUp(lineTotal * TEN_THOUSAND, TEN_THOUSAND + i.rateBp);
  const [cgst, sgst, igst] = i.intraState
    ? [roundHalfUp(taxableRaw * i.rateBp, TWENTY_THOUSAND), roundHalfUp(taxableRaw * i.rateBp, TWENTY_THOUSAND), ZERO]
    : [ZERO, ZERO, roundHalfUp(taxableRaw * i.rateBp, TEN_THOUSAND)];
  return { taxable: lineTotal - (cgst + sgst + igst), cgst, sgst, igst, lineTotal };
}

/** All taxable values t in [1, maxSearch] where t*bp ≡ modulus/2 (mod modulus): EXACT half-paisa ties. */
export function findTieTaxables(rateBp: number, modulus: 10000 | 20000, limit: number): number[] {
  const half = modulus / 2;
  const results: number[] = [];
  const maxSearch = modulus * 10;
  for (let t = 1; t <= maxSearch && results.length < limit; t++) {
    if ((t * rateBp) % modulus === half) {
      results.push(t);
    }
  }
  return results;
}
