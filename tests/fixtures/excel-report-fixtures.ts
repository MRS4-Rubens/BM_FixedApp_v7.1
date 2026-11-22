/**
 * Fixed, deterministic report data for the Excel export tests (PERF-002b).
 * Covers every sheet and branch of the four report builders: all GSTR-1 tables populated,
 * missing customer names/GSTINs, zero-rate slots, and an annual ITR report (sheets 2 and 3).
 */
import type { Gstr1ExportData } from '@/lib/actions/reports/get-gstr1-data';
import type { ExportData } from '@/lib/actions/reports/get-export-data';
import type { ItrExportData } from '@/lib/actions/reports/get-itr-data';

const RATES = [0, 5, 12, 18, 28] as const;

export const gstr1Fixture: Gstr1ExportData = {
  business: { legal_name: 'Fixture Traders Pvt Ltd', trade_name: 'Fixture', gstin: '29ABCDE1234F1Z5', state_code: '29' },
  label: 'FY 2026-27',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  b2b: Array.from({ length: 25 }, (_, i) => ({
    recipientGstin: `27ABCDE${String(1000 + i).padStart(4, '0')}F1Z${(i % 9) + 1}`,
    receiverName: `Buyer ${i % 7}`,
    invoiceNumber: `INV-${String(Math.floor(i / 3) + 1).padStart(4, '0')}`,
    invoiceDate: '01-Nov-2026',
    invoiceValuePaise: 1_180_00 + i * 101,
    placeOfSupply: '27-Maharashtra',
    reverseCharge: 'N',
    applicableTaxRatePercent: '',
    invoiceType: 'Regular',
    eCommerceGstin: '',
    ratePercentage: RATES[(i % 4) + 1],
    taxableValuePaise: 1_000_00 + i * 37,
    cessAmountPaise: i % 5 === 0 ? 1_25 : 0,
  })),
  b2cl: [
    { invoiceNumber: 'INV-B2CL-1', invoiceDate: '02-Aug-2026', invoiceValuePaise: 1_50_000_00, placeOfSupply: '33-Tamil Nadu', applicableTaxRatePercent: '', ratePercentage: 18, taxableValuePaise: 1_27_118_64, cessAmountPaise: 0, eCommerceGstin: '' },
    { invoiceNumber: 'INV-B2CL-2', invoiceDate: '15-Sep-2026', invoiceValuePaise: 2_00_000_00, placeOfSupply: '07-Delhi', applicableTaxRatePercent: '', ratePercentage: 28, taxableValuePaise: 1_56_250_00, cessAmountPaise: 0, eCommerceGstin: '' },
  ],
  b2cs: Array.from({ length: 6 }, (_, i) => ({
    type: 'OE',
    placeOfSupply: i % 2 === 0 ? '29-Karnataka' : '32-Kerala',
    applicableTaxRatePercent: '',
    ratePercentage: RATES[(i % 4) + 1],
    taxableValuePaise: 5_000_00 + i,
    cessAmountPaise: 0,
    eCommerceGstin: '',
  })),
  cdnr: Array.from({ length: 4 }, (_, i) => ({
    recipientGstin: `29XYZAB${String(2000 + i).padStart(4, '0')}C1Z1`,
    receiverName: `Registered Customer ${i}`,
    noteNumber: `CN-${String(i + 1).padStart(3, '0')}`,
    noteDate: '05-Nov-2026',
    noteType: 'C',
    placeOfSupply: '29-Karnataka',
    reverseCharge: 'N',
    noteSupplyType: 'Regular',
    noteValuePaise: 2_360_00 + i,
    applicableTaxRatePercent: '',
    ratePercentage: 18,
    taxableValuePaise: 2_000_00 + i,
    cessAmountPaise: 0,
  })),
  cdnur: [
    { urType: 'B2CL', noteNumber: 'CN-UR-1', noteDate: '20-Aug-2026', documentType: 'C', originalInvoiceNumber: 'INV-B2CL-1', originalInvoiceDate: '02-Aug-2026', placeOfSupply: '33-Tamil Nadu', noteValuePaise: 11_800_00, applicableTaxRatePercent: '', ratePercentage: 18, taxableValuePaise: 10_000_00, cessAmountPaise: 0 },
  ],
  // MONEY-05: Table 12 B2B and B2C tabs (one row each, so both sheets are covered by the golden files).
  hsnB2b: [
    { hsnSacCode: '998313', description: 'IT consulting', uqc: 'NA', totalQuantity: 12, totalValuePaise: 14_160_00, ratePercentage: 18, taxableValuePaise: 12_000_00, integratedTaxPaise: 2_160_00, centralTaxPaise: 0, stateUtTaxPaise: 0, cessAmountPaise: 0 },
  ],
  hsnB2c: [
    { hsnSacCode: '8471', description: 'Laptops', uqc: 'NOS', totalQuantity: 3, totalValuePaise: 1_79_200_00, ratePercentage: 28, taxableValuePaise: 1_40_000_00, integratedTaxPaise: 0, centralTaxPaise: 19_600_00, stateUtTaxPaise: 19_600_00, cessAmountPaise: 0 },
  ],
  docs: [
    { natureOfDocument: 'Invoices for outward supply', srNoFrom: 'INV-0001', srNoTo: 'INV-0009', totalNumber: 9, cancelled: 1, netIssued: 8 },
    { natureOfDocument: 'Credit Note', srNoFrom: 'CN-001', srNoTo: 'CN-005', totalNumber: 5, cancelled: 0, netIssued: 5 },
  ],
  summary: {
    b2bCount: 9, b2bTaxablePaise: 25_011_100, b2bTaxPaise: 3_456_789,
    b2clCount: 2, b2clTaxablePaise: 28_336_864, b2clTaxPaise: 6_663_136,
    b2csCount: 6, b2csTaxablePaise: 3_000_015, b2csTaxPaise: 451_234,
    cdnrCount: 4, cdnrTaxablePaise: 800_006, cdnrTaxPaise: 144_001,
    cdnurCount: 1, cdnurTaxablePaise: 1_000_000, cdnurTaxPaise: 180_000,
    totalTaxablePaise: 55_347_979, totalCgstPaise: 1_960_000, totalSgstPaise: 1_960_000,
    totalIgstPaise: 6_651_159, totalTaxPaise: 10_571_159, totalInvoiceValuePaise: 65_919_138,
  },
};

export const salesRegisterFixture: ExportData = {
  business: { legal_name: 'Fixture Traders Pvt Ltd', gstin: '29ABCDE1234F1Z5' },
  label: 'FY 2026-27',
  invoices: Array.from({ length: 12 }, (_, i) => ({
    invoice_number: `INV-${String(i + 1).padStart(4, '0')}`,
    invoice_date: i === 3 ? null : `2026-0${(i % 9) + 1}-1${i % 10}`,
    customer_name: i % 4 === 0 ? null : `Customer ${i}`,
    customer_gstin: i % 3 === 0 ? null : `29AAAAA${String(1000 + i)}A1Z5`,
    place_of_supply_state_code: [null, '29', '27', '99'][i % 4],
    subtotal_paise: 10_000_00 + i * 333,
    total_cgst_paise: i % 2 === 0 ? 900_00 + i : 0,
    total_sgst_paise: i % 2 === 0 ? 900_00 + i : 0,
    total_igst_paise: i % 2 === 1 ? 1_800_00 + i : 0,
    total_tax_paise: 1_800_00 + i * 2,
    grand_total_paise: 11_800_00 + i * 335,
    payment_status: ['paid', 'unpaid', 'partially_paid'][i % 3],
  })),
  creditNotes: Array.from({ length: 3 }, (_, i) => ({
    credit_note_number: `CN-${i + 1}`,
    issue_date: i === 1 ? null : '2026-10-05',
    subtotal_paise: 1_000_00 + i,
    total_cgst_paise: i === 0 ? 90_00 : 0,
    total_sgst_paise: i === 0 ? 90_00 : 0,
    total_igst_paise: i === 0 ? 0 : 180_00,
    total_tax_paise: 180_00,
    grand_total_paise: 1_180_00 + i,
  })),
  hsnSummary: [
    { hsn_sac_code: '998313', description: 'IT consulting', unit_of_measurement: 'NA', total_quantity: 12, taxable_value_paise: 12_000_00, tax_rate_percentage: 18, cgst_paise: 0, sgst_paise: 0, igst_paise: 2_160_00, total_tax_paise: 2_160_00, total_value_paise: 14_160_00 },
    { hsn_sac_code: '8471', description: 'Laptops', unit_of_measurement: 'NOS', total_quantity: 3, taxable_value_paise: 1_40_000_00, tax_rate_percentage: 28, cgst_paise: 19_600_00, sgst_paise: 19_600_00, igst_paise: 0, total_tax_paise: 39_200_00, total_value_paise: 1_79_200_00 },
  ],
  periodTotals: {
    totalInvoices: 12,
    totalTaxableValuePaise: 1_20_021_978,
    totalCgstPaise: 5_400_030,
    totalSgstPaise: 5_400_030,
    totalIgstPaise: 10_800_036,
    totalTaxPaise: 21_600_132,
    totalInvoiceValuePaise: 1_41_622_110,
  },
};

function itrFixture(isAnnual: boolean, supportedRates: number[]): ItrExportData {
  const invoices = Array.from({ length: 10 }, (_, i) => ({
    id: `inv-${i}`,
    invoice_number: `INV-${String(i + 1).padStart(4, '0')}`,
    invoice_date: i === 2 ? null : `2026-0${(i % 9) + 1}-15`,
    customer_name: i % 4 === 0 ? null : `Customer ${i}`,
    customer_gstin: i % 3 === 0 ? null : `29AAAAA${String(1000 + i)}A1Z5`,
    rates: { [RATES[i % 5]]: 1_000_00 + i * 11, ...(i % 3 === 0 ? { 18: 500_00 } : {}) } as Record<number, number>,
    subtotal_paise: 1_500_00 + i,
    total_tax_paise: 200_00 + i,
    grand_total_paise: 1_700_00 + i,
    payment_status: 'paid',
  }));
  return {
    business: { legal_name: 'Fixture Traders Pvt Ltd', trade_name: null, gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F' },
    label: isAnnual ? 'FY 2026-27' : 'Nov 2026',
    startDate: isAnnual ? '2026-04-01' : '2026-11-01',
    endDate: isAnnual ? '2027-03-31' : '2026-11-30',
    isAnnual,
    supportedRates,
    invoices,
    rateTotals: { 0: 2_000_00, 5: 2_011_00, 12: 2_022_00, 18: 4_533_00 },
    totalSalesTaxablePaise: 15_045_00,
    totalTaxPaise: 2_045_00,
    grandTotalSalesPaise: 17_045_00,
    monthlySummary: isAnnual
      ? [
          { monthKey: '2026-04', monthLabel: 'Apr 2026', quarterLabel: 'Q1 (Apr-Jun)', invoiceCount: 4, rates: { 5: 1_011_00, 18: 500_00 }, subtotal_paise: 6_000_00, total_tax_paise: 800_00, grand_total_paise: 6_800_00 },
          { monthKey: '2026-05', monthLabel: 'May 2026', quarterLabel: 'Q1 (Apr-Jun)', invoiceCount: 6, rates: { 0: 2_000_00, 12: 2_022_00 }, subtotal_paise: 9_045_00, total_tax_paise: 1_245_00, grand_total_paise: 10_290_00 },
        ]
      : [],
    turnover44Ad: {
      digitalReceiptsPaise: 10_000_00,
      cashReceiptsPaise: 3_000_00,
      unpaidReceivablesPaise: 2_045_00,
      totalTurnoverPaise: 15_045_00,
      presumptiveDigitalProfitPaise: 60_000,
      presumptiveCashProfitPaise: 40_360,
      totalPresumptiveProfitPaise: 1_00_360,
    },
  };
}

export const itrMonthlyFixture = itrFixture(false, [0, 5, 12, 18, 28]);
export const itrAnnualFixture = itrFixture(true, [0, 5, 12, 18, 28]);
/** An empty supportedRates list makes the builder fall back to the default 0/5/12/18/28 slabs. */
export const itrDefaultRatesFixture = itrFixture(false, []);
