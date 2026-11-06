export interface CustomerOption {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
  readonly state_code: string;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly city: string | null;
  readonly pincode: string | null;
  readonly phone: string | null;
}

export interface ProductOption {
  readonly id: string;
  readonly name: string;
  readonly hsn_sac_code: string;
  readonly unit_of_measurement: string;
  readonly default_sale_price_paise: number;
  readonly default_tax_rate_id: string | null;
}
