export const INDIAN_GST_STATES = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
] as const;

export type IndianGstStateCode = (typeof INDIAN_GST_STATES)[number]['code'];

// Standard 2-Letter GST State / UT Abbreviation Mapping
export const STATE_CODE_TO_ABBR: Record<string, string> = {
  '01': 'JK',
  '02': 'HP',
  '03': 'PB',
  '04': 'CH',
  '05': 'UK',
  '06': 'HR',
  '07': 'DL',
  '08': 'RJ',
  '09': 'UP',
  '10': 'BR',
  '11': 'SK',
  '12': 'AR',
  '13': 'NL',
  '14': 'MN',
  '15': 'MZ',
  '16': 'TR',
  '17': 'ML',
  '18': 'AS',
  '19': 'WB',
  '20': 'JH',
  '21': 'OD',
  '22': 'CG',
  '23': 'MP',
  '24': 'GJ',
  '26': 'DD',
  '27': 'MH',
  '29': 'KA',
  '30': 'GA',
  '31': 'LD',
  '32': 'KL',
  '33': 'TN',
  '34': 'PY',
  '35': 'AN',
  '36': 'TS',
  '37': 'AP',
  '38': 'LA',
};

export function getStateAbbrByCode(code?: string | null): string {
  if (!code) return '—';
  return STATE_CODE_TO_ABBR[code] || code;
}

const VALID_STATE_CODES: ReadonlySet<string> = new Set(INDIAN_GST_STATES.map((state) => state.code));

/** True only for a real GST state/UT code present in INDIAN_GST_STATES. */
export function isValidStateCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && VALID_STATE_CODES.has(code);
}

/**
 * Union Territories WITHOUT a legislature under Section 1(2) of the UTGST Act, 2017:
 * - 04 Chandigarh
 * - 26 Dadra and Nagar Haveli and Daman and Diu
 * - 31 Lakshadweep
 * - 35 Andaman and Nicobar Islands
 * - 38 Ladakh
 *
 * For intra-territory supplies originating from these jurisdictions, the state tax
 * component is levied as Union Territory Goods and Services Tax (UTGST) instead of SGST
 * pursuant to CGST Rule 46(h) and UTGST Act s. 1(2).
 *
 * Note: Delhi (07), Puducherry (34), and Jammu and Kashmir (01) have their own legislatures
 * and levy State GST (SGST), keeping the standard CGST + SGST tax split.
 */
export const UTGST_STATE_CODES = ['04', '26', '31', '35', '38'] as const;

export type UtgstStateCode = (typeof UTGST_STATE_CODES)[number];

export type StateTaxLabel = 'SGST' | 'UTGST';

const UTGST_STATE_CODE_SET: ReadonlySet<string> = new Set(UTGST_STATE_CODES);

/**
 * Returns 'UTGST' if the supplier's state code corresponds to a Union Territory without
 * a legislature (04, 26, 31, 35, 38), else 'SGST' (default for states, UTs with legislature,
 * unknown or missing codes).
 */
export function stateTaxLabel(stateCode: string | null | undefined): StateTaxLabel {
  if (typeof stateCode === 'string' && UTGST_STATE_CODE_SET.has(stateCode)) {
    return 'UTGST';
  }
  return 'SGST';
}

// Codes 25 and 28 are permanently discontinued (old Daman & Diu and old undivided Andhra Pradesh respectively) and are deliberately excluded from this list — a new GSTIN will never use them. This list is reference data, not user input; it should only ever change via an explicit future government notification, never guessed.

