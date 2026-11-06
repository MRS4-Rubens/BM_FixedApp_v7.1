# TEST-001 Findings: Money, GST, Numbering, Dates, Status, Entitlements & Words

This document records all discrepancies, edge cases, statutory ambiguities, and design observations identified during the implementation of unit test suite **TEST-001** for Bill Matrix.

---

## Summary Matrix

| ID | Title | Status | Severity | Test File | Suggested Owner |
|---|---|---|---|---|---|
| **F-GST-1** | Intra-state tie-breaking & odd-paise split symmetry | `fixed-in-repo` | Medium | `tests/unit/gst-calculate.test.ts` | Tax Engine / CA |
| **F-GST-2** | Floating-point imprecision in `quantity * unitPrice` (`1.005 * 100`) | `fixed-in-repo` | High | `tests/unit/gst-calculate.test.ts` | Core Engine |
| **F-GST-3** | Compensation Cess application order vs taxable value | `informational` | Low | `tests/unit/gst-calculate.test.ts` | Product / CA |
| **F-GST-4** | Legal rupee rounding at document vs line item level (CGST Act § 170) | `informational` | Medium | `tests/unit/round-to-rupee.test.ts` | Tax Compliance |
| **F-NUM-1** | Format `{FY}` vs `{FYYYY}` in 16-character Rule 46(b) limit | `spec-defect` | Medium | `tests/unit/invoice-number-format.test.ts` | Settings UI |
| **F-ENT-1** | Trial plan with NULL `trial_ends_at` fallback | `fixed-in-repo` | High | `tests/unit/entitlements.test.ts` | Subscriptions Team |
| **F-ENT-2** | Grace period expiration boundary (millisecond vs day) | `informational` | Low | `tests/unit/entitlements.test.ts` | Subscriptions UI |
| **F-ENT-3** | Overdue plan status: read-only grace vs hard lockout | `informational` | Medium | `tests/unit/entitlements.test.ts` | Auth / Subscriptions |
| **F-WORDS-1**| Negative amount in `number-to-words` throws unhandled `RangeError` | `code-defect` | Low | `tests/unit/number-to-words.test.ts` | PDF Generator |
| **F-STATUS-1**| `computePaymentStatus` does not filter soft-deleted payment records | `code-defect` | Medium | `tests/unit/invoice-status.test.ts` | Payments Team |
| **F-IST-1** | Month notation and timezone invariance in IST date helpers | `informational` | Low | `tests/unit/ist-date.test.ts` | Utilities |

---

## Detailed Findings

### F-GST-1: Intra-state tie-breaking & odd-paise split symmetry
- **Status**: `fixed-in-repo` (preserves existing integer paise conservation contract)
- **Severity**: Medium
- **Test File**: `tests/unit/gst-calculate.test.ts`
- **Description**:
  When total tax evaluates to an odd number of paise (e.g. 50 paise at 5% GST = 2.5 paise -> rounds half-up to 3 paise), splitting evenly between CGST and SGST yields 1.5 paise each. If rounded independently half-up, CGST = 2 and SGST = 2, giving total tax 4 != 3 paise.
  The engine solves this by calculating:
  `cgstPaise = Math.round(taxPaise / 2)` (e.g. 2 paise)
  `sgstPaise = taxPaise - cgstPaise` (e.g. 1 paise)
  This guarantees `cgstPaise + sgstPaise === totalTaxPaise`. While legally CGST and SGST are symmetric under GST acts, the 1-paise variance is an inevitable artifact of integer-cent rounding.
- **Minimal Reproduction**:
  `calculateInvoiceTax({ sellerStateCode: '27', placeOfSupplyStateCode: '27', lineItems: [{ quantity: 0.5, unitPricePaise: 100, taxRatePercentage: 5 }] })`
  Yields `taxableAmountPaise: 50, cgstAmountPaise: 2, sgstAmountPaise: 1, totalTaxPaise: 3`.
- **Suggested Next Action**: Retain current conservative formula; documented in architectural ADR for audit defence.

---

### F-GST-2: Floating-point imprecision in `quantity * unitPrice` (`1.005 * 100`)
- **Status**: `fixed-in-repo` (fixed in `lib/gst/calculate.ts` and `lib/money.ts` via milli-arithmetic integer scaling)
- **Severity**: High
- **Test File**: `tests/unit/gst-calculate.test.ts`, `tests/unit/money-edge.test.ts`
- **Description**:
  In standard IEEE 754 floating point:
  `1.005 * 100` evaluates to `100.49999999999999`. A naive `Math.round(100.49999999999999)` returns `100` instead of the mathematically correct half-up result `101`.
  The sibling branch introduced `parseQuantityToMilli` and `multiplyMilliByPaiseRoundHalfUp`, computing:
  `Math.floor((1005n * 100n + 500n) / 1000n) = 101n`.
- **Minimal Reproduction**:
  `parseQuantityToMilli(1.005)` -> `1005` milli-units.
  `multiplyMilliByPaiseRoundHalfUp(1.005, 100)` -> `101`.
- **Suggested Next Action**: Guarded by SPEC test `tests/unit/money-edge.test.ts`.

---

### F-GST-3: Compensation Cess application order vs taxable value
- **Status**: `informational`
- **Severity**: Low
- **Test File**: `tests/unit/gst-calculate.test.ts`
- **Description**:
  Under the Goods and Services Tax (Compensation to States) Act 2017, Cess is levied on the taxable value of goods, completely parallel to CGST/SGST/IGST, not compounded on top of them. Currently, Bill Matrix models standard tax rates (0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28) and does not have an explicit separate Cess column.
- **Suggested Next Action**: When Cess support is implemented in Phase 3, ensure it computes against line item `taxableAmountPaise` directly and does not cascade on CGST/SGST.

---

### F-GST-4: Legal round-to-the-nearest-rupee at document level vs line level (CGST Act § 170)
- **Status**: `informational`
- **Severity**: Medium
- **Test File**: `tests/unit/round-to-rupee.test.ts`
- **Description**:
  Section 170 of the CGST Act 2017 specifies:
  *"The amount of tax, interest, penalty, fine or any other sum payable, and the amount of refund or any other sum due, under the provisions of this Act shall be rounded off to the nearest rupee and, for this purpose, where such amount contains a part of a rupee consisting of paise, then, if such part is fifty paise or more, it shall be increased to one rupee and if such part is less than fifty paise it shall be ignored."*
  In statutory invoicing, invoices display paise-accurate line items and total amounts. Rupee rounding is applied either:
  1. As an explicit `Round Off (+/-)` adjustment line item on the invoice.
  2. At payment settlement time.
  The helper `roundToRupeePaise` in `lib/credit-notes/derivation.ts` provides the exact statutory rounding formula `roundHalfUp(paise / 100) * 100`.
- **Suggested Next Action**: Ensure credit note derivations and payment actions consistently invoke `roundToRupeePaise`.

---

### F-NUM-1: Format `{FY}` vs `{FYYYY}` in 16-character Rule 46(b) limit
- **Status**: `spec-defect`
- **Severity**: Medium
- **Test File**: `tests/unit/invoice-number-format.test.ts`
- **Description**:
  CGST Rule 46(b) mandates that invoice numbers must not exceed 16 characters and contain only alphanumeric characters, slashes, or hyphens.
  The token `{FY}` expands to 5 chars (e.g., `25-26`).
  The token `{FYYYY}` expands to 7 chars (e.g., `2025-26`).
  If a user configures a long organization prefix such as `CORP-NORTH/` (11 chars) with `{FY}/{SEQ:4}`, total resolved length is `11 + 5 + 4 = 20 > 16`.
  `validateInvoiceNumberFormat` correctly detects this statically and calculates the exact number of characters to shorten (`maxResolvedLength - 16`).
- **Suggested Next Action**: Guarded by SPEC test. Front-end settings UI should provide live length counters.

---

### F-ENT-1: Trial plan with NULL `trial_ends_at` fallback
- **Status**: `fixed-in-repo`
- **Severity**: High
- **Test File**: `tests/unit/entitlements.test.ts`
- **Description**:
  If a tenant database row indicates `plan: 'trial'` but `trial_ends_at` is `null` or unpopulated, earlier versions could fail open or throw unexpected null errors.
  `resolveEntitlements` handles this by falling back safely to:
  `tier: 'free'`, `effectiveStatus: 'expired'`, `daysRemaining: 0`, `targetExpiry: null`.
- **Suggested Next Action**: Guarded by SPEC test in `tests/unit/entitlements.test.ts`.

---

### F-ENT-2: Grace period expiration boundary (millisecond vs day)
- **Status**: `informational`
- **Severity**: Low
- **Test File**: `tests/unit/entitlements.test.ts`
- **Description**:
  `getGracePeriodDaysRemaining` computes remaining duration using millisecond difference divided by `86_400_000`. If an entitlement expires at 10:00:00 and the current time is 10:00:01, `daysRemaining` drops to 0 immediately.
- **Suggested Next Action**: Provide UI tooltips clarifying exact UTC/IST expiration timestamps when `daysRemaining <= 1`.

---

### F-ENT-3: Overdue plan status: read-only grace vs hard lockout
- **Status**: `informational`
- **Severity**: Medium
- **Test File**: `tests/unit/entitlements.test.ts`
- **Description**:
  When a tenant enters `overdue` status, invoice and credit note creation is blocked (`canCreateInvoice: false`, `canCreateCreditNote: false`), but read-only access (viewing documents, viewing GST reports, downloading PDF archives) is retained.
  This is essential for legal compliance because Indian businesses must retain and inspect GST invoices even during payment disputes.
- **Suggested Next Action**: Formally document this policy in `ARCHITECTURE.md`.

---

### F-WORDS-1: Negative amount in `number-to-words` throws unhandled `RangeError`
- **Status**: `code-defect`
- **Severity**: Low
- **Test File**: `tests/unit/number-to-words.test.ts`
- **Description**:
  `amountInWords(amountPaise)` in `lib/pdf/number-to-words.ts` enforces `if (amountPaise < 0) throw new RangeError('amountPaise cannot be negative')`.
  If a caller formats a negative net credit note balance or negative refund using `amountInWords`, an unhandled `RangeError` is thrown, crashing PDF generation.
- **Suggested Next Action**: Either:
  1. Add negative handling returning `'Minus ' + amountInWords(Math.abs(amountPaise))`.
  2. Document caller precondition that only absolute paise amounts are allowed.

---

### F-STATUS-1: `computePaymentStatus` does not filter soft-deleted payment records
- **Status**: `code-defect`
- **Severity**: Medium
- **Test File**: `tests/unit/invoice-status.test.ts`
- **Description**:
  `computePaymentStatus` takes an array of payments and sums `amount_paise`. If callers fetch payments without filtering `where: isNull(payments.deleted_at)`, soft-deleted payments will artificially inflate the paid amount, causing an unpaid invoice to display as `paid`.
- **Suggested Next Action**: Add defensive check `p.deleted_at == null` inside `computePaymentStatus` or enforce in query typing.

---

### F-IST-1: Month notation and timezone invariance in IST date helpers
- **Status**: `informational`
- **Severity**: Low
- **Test File**: `tests/unit/ist-date.test.ts`
- **Description**:
  `getIstDateParts` and `formatIstDate` utilize `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })`. This guarantees consistent date resolution irrespective of whether the application server runs in `UTC`, `America/Los_Angeles`, or `Asia/Kolkata`.
- **Suggested Next Action**: Verified by cross-timezone test execution.
