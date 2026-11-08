export interface InvoiceLineItem {
  id: string;
  description: string;
  hsn_sac_code: string | null;
  quantity: string | number;
  unit_price_paise: number;
  discount_paise: number;
  taxable_value_paise: number;
  tax_rate_percentage: string | number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
}

