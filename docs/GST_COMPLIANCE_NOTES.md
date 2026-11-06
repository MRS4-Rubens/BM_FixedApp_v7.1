# GST Compliance Notes — Bill Matrix

## GSTR-1 Outward Supply Classifications

### 1. B2C Large (B2CL) vs B2C Small (B2CS) — Effective-Dated Threshold

- **Statutory basis:** Notification No. 12/2024-Central Tax dated 10 July 2024, issued under section 164 of the CGST Act, 2017, amending clause (iii) of the Explanation to Rule 59(4)(b) of the CGST Rules, 2017.
- **GSTN advisory:** Advisory dated 3 September 2024 published on the GST Portal confirming that the enhanced reporting threshold applies to outward supplies from 1 August 2024 onwards.
- **Threshold rule:**
  - Invoices dated **on or before 2024-07-31**: an inter-State invoice to an unregistered recipient is classified as **B2CL (Table 5)** if and only if its grand total exceeds **Rs 2,50,000** (25,000,000 paise).
  - Invoices dated **on or after 2024-08-01**: an inter-State invoice to an unregistered recipient is classified as **B2CL (Table 5)** if and only if its grand total exceeds **Rs 1,00,000** (10,000,000 paise).
  - All other outward supplies to unregistered recipients (intra-State at any value, and inter-State below or equal to the threshold in force on the invoice date) are classified as **B2CS (Table 7)**.
- **Invoice-date policy:** The threshold is evaluated strictly using the **original invoice date** (`invoices.invoice_date`), not the date on which the return is filed, not the financial year, and not the credit-note issue date. This preserves historical accuracy for past periods and amended returns.

### 2. Credit and Debit Notes to Unregistered Recipients (CDNUR vs B2CS)

- **GST portal schema:**
  - Table 9B of GSTR-1 contains two schedules: **CDNR** (credit/debit notes to registered persons, reported with the recipient's GSTIN) and **CDNUR** (credit/debit notes to unregistered persons, reported invoice-wise).
  - Under GSTR-1 filing instructions, CDNUR reports **only** those credit and debit notes that were issued against **B2CL** invoices.
  - Credit and debit notes issued against **B2CS** invoices are **not** reported invoice-wise in Table 9B; instead, their taxable and tax values are **netted directly out of the outward supplies reported in Table 7 (B2CS)** for the corresponding Place of Supply and GST tax rate.
- **Bill Matrix implementation:**
  - `lib/actions/reports/get-gstr1-data.ts` inspects each credit note to an unregistered recipient and looks up the original invoice (`original_invoice_id` via the API-004 link).
  - If the original invoice was an inter-State invoice whose grand total strictly exceeded the B2CL threshold **in force on that original invoice's date**, the credit note is emitted into the **`cdnur`** sheet (Table 9B CDNUR) with the original invoice number and date.
  - Otherwise, the credit note is netted out of the aggregated `b2cs` bucket matching the Place of Supply and tax rate.
  - In all cases, unregistered credit notes reduce the period's total outward supplies reported on the summary sheet.
- **Voided notes:** Credit notes with `status = 'voided'` are excluded from all GSTR-1 tables.

### 3. Verification & Code Pointers

- Threshold table: `lib/gst/thresholds.ts`
- GSTR-1 aggregation: `lib/actions/reports/get-gstr1-data.ts`
- Excel workbook generation: `lib/excel/build-gstr1-report.ts`
- Unit tests: `tests/unit/gst-thresholds.test.ts`
- Integration tests: `tests/integration/comp002-gstr1-classification.test.ts`

