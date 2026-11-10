# Phase 4 Completion Report: Issue COMP-UTGST — UTGST Display Support

**Issue**: Phase 4, Issue COMP-UTGST — Show UTGST instead of SGST for intra-territory supplies in Union Territories without a legislature.  
**Branch**: `fix/comp-utgst`  
**Status**: Completed (changes uncommitted as instructed)  
**Date**: November 10, 2026  

---

## 1. Statutory Context & Legal Basis

- **Legal Rules**: UTGST Act, 2017 § 1(2) read with CGST Rules, 2017 Rule 46 (tax invoice requirements).
- **Core Principle**: For an intra-state/intra-territory supply, the tax component corresponding to state tax is **UTGST** (Union Territory Goods and Services Tax) when the supplier's state code is a Union Territory **without a legislature**:
  - `04` — Chandigarh
  - `26` — Dadra and Nagar Haveli and Daman and Diu
  - `31` — Lakshadweep
  - `35` — Andaman and Nicobar Islands
  - `38` — Ladakh
- **Territories Retaining SGST**:
  - `07` — Delhi (National Capital Territory)
  - `34` — Puducherry
  - `01` — Jammu and Kashmir  
  These three Union Territories have their own legislative assemblies and enacted State GST legislation; their intra-territory supplies are charged to **SGST**. All 28 States also retain SGST.
- **Inter-State Supplies**: Any supply spanning across state/UT borders (including from a UT without legislature to another state or UT) attracts Integrated Goods and Services Tax (**IGST**) exclusively under IGST Act § 5.
- **Invariance Contract**:
  - Tax computation, percentage rates, line item split, integer paise amounts, and rounding rules are mathematically identical between SGST and UTGST.
  - Zero database migrations (`pnpm db:generate` reports 0 schema changes).
  - Existing database columns `total_sgst_paise` and `sgst_paise` on `invoices`, `credit_notes`, and line item tables hold SGST or UTGST uniformly.
  - Presentation and statutory document generation dynamically resolve `{taxLabel}` via single source of truth `stateTaxLabel(stateCode)`.

---

## 2. SGST Grep Audit & Decisions

Every occurrence of `"SGST"` found in `app/`, `components/`, and `lib/` (*.ts, *.tsx) is recorded below along with the exact architectural decision implemented:

| # | File & Line | Content Match | Decision Taken |
|---|---|---|---|
| 1 | `app/(app)/dashboard/page.tsx:199` | `{ label: 'SGST', amount: currentMonthSales.total_sgst, color: 'bg-amber-500' }` | **Updated**: Dynamic `{ label: taxLabel, ... }` resolved from `getCurrentBusiness().state_code` using `stateTaxLabel`. |
| 2 | `app/(app)/reports/client.tsx:150` | `SGST:` | **Updated**: Changed to `SGST/UTGST:` to neutrally cover aggregate reporting across multiple states/UTs. |
| 3 | `app/(app)/reports/client.tsx:212` | `description: '... and CGST/SGST/IGST.'` | **Updated**: Changed description to `and CGST/SGST/UTGST/IGST.`. |
| 4 | `app/(app)/reports/client.tsx:618` | `name="SGST"` (Recharts bar display name) | **Updated**: Changed display name to `name="SGST/UTGST"`. Data key `dataKey="total_sgst"` preserved strictly unchanged. |
| 5 | `app/(app)/reports/client.tsx:670` | `SGST: <strong ...>{formatCurrency(totalSgst)}</strong>` | **Updated**: Changed to `SGST/UTGST:`. |
| 6 | `components/app/credit-notes/credit-note-form.tsx:316` | `{isIntraState ? 'Intra-State (CGST+SGST)' : 'Inter-State (IGST)'}` | **Updated**: Changed to ``Intra-State (CGST+${taxLabel})`` using seller state code. |
| 7 | `components/app/credit-notes/credit-note-form.tsx:553` | `<span>SGST:</span>` | **Updated**: Changed to `<span>{taxLabel}:</span>`. |
| 8 | `components/app/credit-notes/credit-note-print-view.tsx:213` | `<th className="... text-right w-16">SGST</th>` | **Updated**: Changed column header to `{taxLabel}` derived from `biz.state_code`. |
| 9 | `components/app/credit-notes/credit-note-print-view.tsx:273` | `<span className="text-gray-600 font-medium">Total SGST:</span>` | **Updated**: Changed to `<span ...>Total {taxLabel}:</span>`. |
| 10 | `components/app/customers/customer-form.tsx:153` | `? 'CGST + SGST (Local)'` | **Unchanged**: Deliberately generic descriptive copy for customer tax region guidance. |
| 11 | `components/app/customers/customer-form.tsx:299` | `Determines CGST/SGST vs IGST` | **Unchanged**: Deliberately generic field tooltip copy. |
| 12 | `components/app/invoices/invoice-form/form-calculations.ts:53` | `totalSGST: number;` | **Unchanged**: Internal TypeScript return interface for calculation bundle. |
| 13 | `components/app/invoices/invoice-form/form-calculations.ts:94` | `const totalSGST = taxResult ? taxResult.totalSgstPaise / 100 : 0;` | **Unchanged**: Internal calculation variable name. |
| 14 | `components/app/invoices/invoice-form/form-calculations.ts:131` | `return { ... totalSGST ... };` | **Unchanged**: Internal calculation return object. |
| 15 | `components/app/invoices/invoice-form/gst-breakdown-card.tsx:39` | `<th>SGST</th>` | **Updated**: Accepts `taxLabel?: StateTaxLabel` (default `'SGST'`); renders `{taxLabel}`. Passed down from `invoice-form.tsx`. |
| 16 | `components/app/invoices/invoice-form/totals-summary-card.tsx:16` | `totalSGST,` | **Unchanged**: Prop name for numeric amount. |
| 17 | `components/app/invoices/invoice-form/totals-summary-card.tsx:27` | `totalSGST: number;` | **Unchanged**: Prop type interface. |
| 18 | `components/app/invoices/invoice-form/totals-summary-card.tsx:45` | `Intra-state Supply (CGST + SGST)` | **Updated**: Changed to ``Intra-state Supply (CGST + ${taxLabel})``. |
| 19 | `components/app/invoices/invoice-form/totals-summary-card.tsx:66` | `SGST` (text beside bullet) | **Updated**: Changed to `{taxLabel}`. |
| 20 | `components/app/invoices/invoice-form/totals-summary-card.tsx:68` | `formatINR(totalSGST)` | **Unchanged**: Numeric formatting helper call. |
| 21 | `components/app/invoices/invoice-form.tsx:210` | `totalSGST,` | **Unchanged**: Destructured calculation variable. |
| 22 | `components/app/invoices/invoice-form.tsx:345` | `totalSGST={totalSGST}` | **Updated / Extended**: Added `const taxLabel = stateTaxLabel(business?.state_code);` and passed `taxLabel={taxLabel}` to both `GstBreakdownCard` and `TotalsSummaryCard`. |
| 23 | `components/app/invoices/templates/template-1.tsx:280` | `<span>SGST</span>` | **Updated**: Changed to `{taxLabel}` computed from `businessStateCode` snapshot. |
| 24 | `components/app/invoices/templates/template-2.tsx:312` | `{/* Add CGST & SGST (Intra State Only) */}` | **Unchanged**: JSX comment. |
| 25 | `components/app/invoices/templates/template-2.tsx:340` | `Add. SGST` | **Updated**: Changed to `Add. {taxLabel}` computed from `businessStateCode` snapshot. |
| 26 | `components/app/invoices/templates/template-3.tsx:384` | `{/* Add CGST & SGST (Intra State Only) */}` | **Unchanged**: JSX comment. |
| 27 | `components/app/invoices/templates/template-3.tsx:412` | `Add. SGST` | **Updated**: Changed to `Add. {taxLabel}` computed from `businessStateCode` snapshot. |
| 28 | `components/app/invoices/templates/template-4.tsx:242` | `<th>SGST</th>` | **Updated**: Changed column header to `{taxLabel}` computed from `businessStateCode` snapshot. |
| 29 | `components/app/invoices/templates/template-4.tsx:481` | `{/* CGST & SGST (Intra-State) ... */}` | **Unchanged**: JSX comment. |
| 30 | `components/app/invoices/templates/template-4.tsx:507` | `Add. SGST` | **Updated**: Changed to `Add. {taxLabel}` computed from `businessStateCode` snapshot. |
| 31 | `components/app/products/product-form.tsx:401` | `... CGST + SGST (Local) or IGST ...` | **Unchanged**: Deliberately generic help tooltip. |
| 32 | `components/app/products/product-form.tsx:408` | `... CGST + SGST (Local) or IGST ...` | **Unchanged**: Deliberately generic help tooltip. |
| 33 | `components/app/products/product-form.tsx:670` | `CGST ...% + SGST ...%` | **Unchanged**: Deliberately generic product rate preview label. |
| 34 | `components/app/settings/profile-spotlight-tour.tsx:88` | `... CGST + SGST (intra-state) vs. IGST ...` | **Unchanged**: Deliberately generic onboarding spotlight text. |
| 35 | `components/landing/features-section.tsx:27` | `Auto-calculated CGST/SGST/IGST ...` | **Unchanged**: Deliberately generic landing marketing copy. |
| 36 | `lib/excel/build-gstr1-report.ts:152` | `// Tax Component Split (CGST, SGST, IGST)` | **Unchanged**: Code comment. |
| 37 | `lib/excel/build-gstr1-report.ts:162` | `['State/UT Tax (SGST)', paiseToRupees(...)]` | **Updated**: Changed to `['State/UT Tax (SGST/UTGST)', paiseToRupees(sum.totalSgstPaise)]`. |
| 38 | `lib/excel/build-hsn-report.ts:70` | `{ header: 'SGST (₹)', key: 'sgst', ... }` | **Updated**: Changed header to `'SGST/UTGST (₹)'`, keeping column key `'sgst'` unchanged. |
| 39 | `lib/excel/build-sales-register.ts:52` | `{ header: 'SGST', key: 'sgst', ... }` | **Updated**: Changed header to `'SGST/UTGST'`, keeping column key `'sgst'` unchanged. |
| 40 | `lib/excel/build-sales-register.ts:134` | `{ header: 'SGST', key: 'sgst', ... }` | **Updated**: Changed header to `'SGST/UTGST'`, keeping column key `'sgst'` unchanged. |
| 41 | `lib/excel/build-sales-register.ts:208` | `{ header: 'SGST', key: 'sgst', ... }` | **Updated**: Changed header to `'SGST/UTGST'`, keeping column key `'sgst'` unchanged. |
| 42 | `lib/excel/build-sales-register.ts:288` | `['Total SGST', paiseToRupees(...)]` | **Updated**: Changed summary label to `['Total SGST/UTGST', paiseToRupees(totals.totalSgstPaise), true]`. |
| 43 | `lib/gst/calculate.ts:110` | `// Adjust taxable value slightly so that TaxableValue + CGST + SGST ...` | **Unchanged**: Calculation logic comment. |
| 44 | `lib/invoices/place-of-supply.ts:16` | `export type TotalsField = 'subtotal' \| 'CGST' \| 'SGST' \| 'IGST' ...` | **Unchanged**: Internal technical union for mismatch validation. |
| 45 | `lib/invoices/place-of-supply.ts:40` | `mismatches.push('SGST')` | **Unchanged**: Internal technical mismatch reporting value. |

---

## 3. Changed Files Summary

1. `lib/gst/indian-states.ts`:
   - Exported `UTGST_STATE_CODES = ['04', '26', '31', '35', '38'] as const;` with detailed statutory doc comment.
   - Exported `type StateTaxLabel = 'SGST' | 'UTGST';`.
   - Exported `stateTaxLabel(stateCode: string | null | undefined): StateTaxLabel`.
2. `lib/db/schema/invoices.ts`, `credit_notes.ts`, `invoice_line_items.ts`, `credit_note_line_items.ts`:
   - Added schema doc comments on `total_sgst_paise` and `sgst_paise` noting they hold SGST or UTGST.
   - Verified 0 schema changes and 0 migrations generated.
3. `components/app/invoices/templates/template-1.tsx` to `template-4.tsx`:
   - Resolved `taxLabel = stateTaxLabel(businessStateCode)`.
   - Updated visible table headers and totals rows (`Add. {taxLabel}`, `{taxLabel}`).
4. `components/app/credit-notes/credit-note-print-view.tsx`:
   - Resolved `taxLabel = stateTaxLabel(biz.state_code)`.
   - Updated table headers and totals labels to `{taxLabel}` / `Total {taxLabel}:`.
5. `components/app/invoices/invoice-form/gst-breakdown-card.tsx` & `totals-summary-card.tsx`:
   - Added `taxLabel?: StateTaxLabel` prop.
   - Updated supply-type badge: `Intra-state Supply (CGST + ${taxLabel})`.
   - Updated row label to `{taxLabel}`.
6. `components/app/invoices/invoice-form.tsx`:
   - Imported `stateTaxLabel`, computed `const taxLabel = stateTaxLabel(business?.state_code);`, and forwarded to both cards.
7. `components/app/credit-notes/credit-note-form.tsx`:
   - Computed `const taxLabel = stateTaxLabel(originalInvoice.supplier_state_code || business.state_code);`.
   - Updated badges and tax row labels to `CGST+${taxLabel}` and `{taxLabel}:`.
8. `app/(app)/dashboard/page.tsx`:
   - Fetched `getCurrentBusiness()` alongside other promises.
   - Resolved `taxLabel = stateTaxLabel(business?.state_code);` and updated GST summary card label.
9. `app/(app)/reports/client.tsx`:
   - Updated aggregate UI labels and Recharts display name to `'SGST/UTGST'` (data keys strictly unchanged).
10. `lib/excel/build-sales-register.ts`, `build-hsn-report.ts`, `build-gstr1-report.ts`:
    - Updated column headers and CA summary titles to `'SGST/UTGST'`, `'SGST/UTGST (₹)'`, `'Total SGST/UTGST'`, `'State/UT Tax (SGST/UTGST)'`.
    - Column keys (`'sgst'`) strictly preserved.
11. `tests/unit/gst-calculate.test.ts`:
    - Replaced `it.todo('F-GST-3: UTGST ...')` with four comprehensive unit tests for `stateTaxLabel`, identical calculation maths between `04` and `27`, inter-state handling `04 -> 07`, and `UTGST_STATE_CODES ⊂ INDIAN_GST_STATES`.
12. `tests/unit/comp-utgst-documents.test.ts` *(new)*:
    - 15 tests covering invoice templates 1–4 and credit note print view across intra-state UT (`04`), intra-state State (`27`), and inter-state (`04 -> 27`).
13. `tests/unit/perf002b-xlsx-golden.test.ts` & golden snapshots:
    - Added explicit assertion test `renders SGST/UTGST headers in Sales Register, HSN Summary, and GSTR-1`.
    - Synchronized the 6 golden xlsx snapshots for the updated header text.
14. `docs/reports/TEST-001-findings.md`:
    - Updated `F-GST-3` entry clarifying that the `it.todo` in `gst-calculate.test.ts` was about UTGST (now `fixed-in-repo`), while Compensation Cess remains informational.
15. `docs/GST_COMPLIANCE_NOTES.md`:
    - Added dedicated "UTGST (Union Territory Goods and Services Tax) — Issue COMP-UTGST" section.

---

## 4. Before & After Label Examples (04 vs 27)

### Example A: Intra-Territory Supply in Chandigarh (Seller Code `04`, Place of Supply `04`)
- **Supply Type Badge**:
  - *Before*: `Intra-state Supply (CGST + SGST)`
  - *After*: `Intra-state Supply (CGST + UTGST)`
- **Invoice Template 1 Column Header & Totals Row**:
  - *Before*: Header: `SGST` \| Totals: `SGST: ₹90.00`
  - *After*: Header: `UTGST` \| Totals: `UTGST: ₹90.00`
- **Invoice Templates 2, 3, 4 Totals Row**:
  - *Before*: `Add. SGST: ₹90.00`
  - *After*: `Add. UTGST: ₹90.00`
- **Credit Note Print View**:
  - *Before*: Header: `SGST` \| Totals: `Total SGST: ₹90.00`
  - *After*: Header: `UTGST` \| Totals: `Total UTGST: ₹90.00`
- **Tax Math**: `9000` paise (₹90.00) — identical in all respects.

### Example B: Intra-State Supply in Maharashtra (Seller Code `27`, Place of Supply `27`)
- **Supply Type Badge**:
  - *Before*: `Intra-state Supply (CGST + SGST)`
  - *After*: `Intra-state Supply (CGST + SGST)`
- **Invoice Templates 1–4**:
  - *Before*: `SGST` / `Add. SGST`
  - *After*: `SGST` / `Add. SGST` (100% byte-for-byte identical markup)
- **Credit Note Print View**:
  - *Before*: `SGST` / `Total SGST:`
  - *After*: `SGST` / `Total SGST:`

### Example C: Inter-State Supply (Seller Code `04`, Place of Supply `27`)
- **Supply Type Badge**: `Inter-state Supply (IGST)`
- **Invoice Templates 1–4**: Only `Add. IGST` rendered. Neither SGST nor UTGST rendered.
- **Credit Note Print View**: Only `Total IGST:` rendered. Neither SGST nor UTGST rendered.

---

## 5. Verification Commands and Results

| Command | Status | Output / Findings |
|---|---|---|
| `pnpm typecheck` | **PASS** (Exit 0) | `tsc --noEmit` clean across entire codebase. |
| `pnpm lint:ratchet` | **PASS** (Exit 0) | ESLint now: 0 errors, 0 warnings. Baseline allows: 0 errors, 0 warnings. |
| `pnpm knip` | **PASS** (Exit 0) | 0 unused exports, files, or dependencies. |
| `pnpm exec vitest run` | **PASS** (Exit 0) | **195 test files passed**, 4 skipped; **1,578 tests passed**, 12 skipped, **0 todo**. |
| `pnpm print-css:build` | **PASS** (Exit 0) | Generated `lib/pdf/print-stylesheet.generated.ts` (223,354 bytes); `git diff` shows **0 diff**. |
| `pnpm db:generate` | **PASS** (Exit 0) | `No schema changes, nothing to migrate 😴` |
| `next build --webpack` (CI placeholder env) | **PASS** (Exit 0) | All 35+ routes compiled, static prerender complete, 0 build errors. |

---

## 6. Observations & Handover

- **Markup Characterization Snapshots**: Existing characterization snapshots (`tests/unit/__snapshots__/debt003-markup-characterization.test.ts.snap` and `debt003b-markup-characterization.test.ts.snap`) remained completely untouched and passed cleanly, proving zero unintended visual regression on Maharashtra fixtures.
- **XLSX Streamed Golden Snapshots**: In accordance with the requirement to update Excel headers (`SGST` -> `SGST/UTGST`), the file snapshots in `tests/unit/__snapshots__/xlsx-golden/` were updated to reflect the new header text, and an explicit test was added to `perf002b-xlsx-golden.test.ts` to assert them.
- **Zero Pending Todos**: The sole repository `it.todo` (`F-GST-3 UTGST`) has been replaced by live tests; Vitest now reports 0 remaining todos across the entire project.
- **Git State**: All changes remain unstaged and uncommitted on branch `fix/comp-utgst`.


---

## Reviewer verification (Claude Code, 2026-11-10)

Reviewed the full diff against `main` (`2a16cca`) and re-ran everything with the CI placeholder environment. No code changes were needed.

### Checked
- **Label sources.**
  - Finalized invoices use the seller state snapshot (`app/(app)/invoices/[id]/page.tsx` passes `seller.stateCode`).
  - Credit-note printouts use `toCreditNotePrintBusiness(sellerDetails, …)`, which is also the frozen seller snapshot.
  - Draft previews and the invoice form use the live business state.
  - The credit-note form uses `originalInvoice.supplier_state_code`.
- **Excel golden snapshots:** only the header cells changed (`SGST` → `SGST/UTGST`, `SGST (₹)` → `SGST/UTGST (₹)`, `Total SGST` → `Total SGST/UTGST`, `State/UT Tax (SGST)` → `State/UT Tax (SGST/UTGST)`). No numbers, rows or column keys moved, and a dedicated header test was added. These goldens describe the header text itself, so updating them is the intended change.
- **No other snapshot changed.** The DEBT-003 markup characterizations for the Maharashtra fixtures are identical.
- **Side-by-side render** with the real PDF stylesheet: template 1 and template 4 for a Chandigarh (04) and a Maharashtra (27) seller, same lines. Layout and every amount are identical; only "UTGST" vs "SGST" differs, and the template-4 column header fits its `w-24` cell.
- **Mutation:** removing '04' from `UTGST_STATE_CODES` fails all 5 document tests (templates 1–4 and the credit note) and the label test. Restored.
- `components/app/invoices/invoice-form.tsx` is 398 lines, under the DEBT-003 guard of 400.

### Commands (reviewer re-run, CI env)
| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint:ratchet` | 0 / 0 (at baseline) |
| `pnpm knip` | no findings |
| `pnpm exec vitest run` | 194 files passed / 4 skipped; 1571 tests passed, 12 skipped, **0 todo** (the last Phase 3 `it.todo` is resolved) |
| `pnpm build` (CI env) | pass |
| `pnpm print-css:build` | unchanged |
