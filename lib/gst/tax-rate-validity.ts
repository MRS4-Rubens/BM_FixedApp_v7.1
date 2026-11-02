export interface TaxRateValidityFields {
  readonly is_active: boolean;
  readonly effective_from: string; // YYYY-MM-DD
  readonly effective_to: string | null;
}

/** ISO date strings compare correctly lexicographically. */
export function isTaxRateEffectiveOn(rate: TaxRateValidityFields, isoDate: string): boolean {
  return rate.is_active && rate.effective_from <= isoDate && (rate.effective_to === null || isoDate <= rate.effective_to);
}
