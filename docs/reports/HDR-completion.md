# HDR — Header redesign of Templates 2, 3 and 4 (completion report)

Branch: `feat/hdr-redesign-t234` · Built directly by Claude Code (the user chose this over an Antigravity prompt, 2026-11-14).

## 1. What changed

All three Pro templates now build their header from one shared system in
`components/app/invoices/templates/header-parts.tsx`, with each template passing its own colours and borders.

| Row | Content | Rule |
|---|---|---|
| 1 | GSTIN · TAX INVOICE · Invoice No (+ Date in T2/T4) | 3-column grid `minmax(max-content,1fr) auto minmax(max-content,1fr)`: TAX INVOICE sits at the exact page centre on A4 and the row never wraps. Invoice numbers are at most 16 characters (CGST Rule 46(b)), so the widest row (~630 px) fits even A5's 664 px. |
| 2 | Logo + business name | `BrandLockup`: one flex group, centred; fixed 12 px gap; the logo's centre is aligned with the centre of the name block. |
| 3 | Tagline pill or "(nature of business)" | Unchanged TAG-B pill; the nature line is 11 px, capitals, spaced 0.12em. |
| 4 | Address │ Ph No. | `ContactLine` with a thin 1 px divider (`MetaDivider`) instead of ◆; the divider stays glued to the phone number. |

**Shared rules**
- **Logo box:** 52 px tall, at most 156 px wide (3:1), `object-contain`. No cropping (the old `overflow-hidden` is gone) and no stretching. The size no longer changes when a tagline is shown.
- **Business name:** capitals, font-black, letter spacing 0.08em (Template 3's look), line height 1.12.
  - `layoutBrandName` keeps names of up to 28 characters on one line (26 px, or 23 px above 24 characters).
  - Longer names are split into 2–4 balanced lines by whole words, so the name box hugs its text and the 12 px gap and centring stay exact. Two or more lines are capped at 22 px, so a two-line name is no taller than the logo. Size steps down by longest line: 20/17/14/13 px.
  - Calibrated by measurement: an average capital letter is about 0.81em wide including spacing.
- **Vertical rhythm:** 8 px from row 1 to the logo row (6 px in T4, because its cards carry their own padding), then 5 px, 5 px, and 8 px to Bill To. T3 uses 1 px, because its buyer row already has a 7 px top margin.
- **Removed hacks:** the logo hanging off the name (`absolute right-full`), T2's `translateX(-1cm)` shift, T4's `left-[-7px]` nudge, T4's `min-h-[75px]`, and the floating absolute GSTIN/meta corners (the cause of the long-name overlap bug).

**Kept identities**
- **T2:** black on white; square 1 px TAX INVOICE box; plain text info row.
- **T3:** royal blue `#0e3f94`; underlined TAX INVOICE; blue rule above the address. Date stays in the buyer row (user's decision: don't touch Bill To).
- **T4:** slate; rounded TAX INVOICE pill; GSTIN card and an Invoice No │ Date card, each now **one row**.

**Not changed:** Template 1, everything from Bill To downward, data, numbering, GST maths, PDF and print pipeline, and the database.

## 2. Verification (measured, not eyeballed)

**Method:**
- A temporary vitest rendered 180 headers: 3 templates × 5 logo shapes (none, square, 3:1, 5:1, 1:2) × 4 name lengths (7, 22, 42, 120 characters) × 3 sublines (none, nature, 80-character tagline), using a worst-case 16-character invoice number.
- A browser page mounted each one in a shadow DOM at 760 px (A4) and 664 px (A5), using the generated print stylesheet, and measured text-line rectangles.
- "Before" was rendered from `main`'s code via `git stash`, with its own stylesheet.

| Check | Before (`main`) | After |
|---|---|---|
| Layouts with overlapping text or logo | 37 / 180 | **0** (also 0 at A5 width) |
| Layouts with text or logo outside the page | 92 / 180 | **0** (also 0 at A5 width) |
| Logo centre vs name centre | — (bottom-anchored) | **≤ 1.0 px** |
| Logo + name group vs page centre | — | **≤ 1.0 px** (the remaining px is the trailing letter spacing) |
| Logo-to-name gap | varied | **12.0 px in all layouts** |
| Logo size across T2/T3/T4 | T2 70/42, T3 64/44, T4 48/28 | **identical:** square 52×52, wide 156×52, tall 26×52 |
| Everything from Bill To downward | — | **byte-identical to `main` in 180/180** |
| Tallest whole page | 743 px | 792 px (A4 content height ≈ 1077 px, so still one page) |

Header height for "BRAJESH KUMAR CLOTHING" (before → after, px):

| | no logo / none | no logo / nature | no logo / tagline | logo / none | logo / nature | logo / tagline |
|---|---|---|---|---|---|---|
| T2 | 102 → 83 | 120 → 101 | 118 → 112 | 102 → 106 | 120 → 124 | 118 → 135 |
| T3 | 100 → 84 | 115 → 102 | 126 → 109 | 100 → 107 | 115 → 125 | 126 → 132 |
| T4 | 85 → 82 | 104 → 99 | 115 → 111 | 85 → 105 | 104 → 122 | 115 → 134 |

- Normal-length names: −19 to +20 px, within the agreed +20 px budget.
- The extreme 120-character name: +30 to +44 px. It needs 4 lines, and it previously ran off the page.

**Tests:**
- `tests/unit/hdr-template-headers.test.ts` (new):
  - line splitting and sizing;
  - the logo box rule;
  - row order;
  - an identical logo box in all three templates;
  - no ◆, no old hacks;
  - T3's Date stays in the buyer row;
  - Template 1 is untouched.
- `tests/unit/tag-b-template-headers.test.ts` (updated): ◆ → thin divider; the T4 right-card test now slices between TAX INVOICE and the logo row.

**Gate:**
- typecheck, `lint:ratchet` (0/0), knip, and the full vitest run with the CI env all pass; `print-css:build` was regenerated.
- `tests/unit/use-server-exports.test.ts` timed out once under full-suite load; it passes when run alone, a load flake like `db-client-pool`.
- The local `next build` was skipped because the user's dev server is running; CI runs it.

**Not checked:** a logged-in view of a real invoice in the app (the browser pane was signed out). The same components and the same print stylesheet were used in the harness.

## 3. Harness lesson (for next time)

Tailwind 4 draws borders through `@property` registrations, which are **ignored inside shadow roots**. In shadow-DOM measuring pages, also load the stylesheet in the document (`<link rel="stylesheet">`), or every `border` renders as `none`. Give each phase (before/after) its own copy of the stylesheet.
