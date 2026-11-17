# G1 — Plan changes between paid plans (feature G, money part)

**Branch:** `feat/plan-change` (from `main` a14971c) · **Built by:** Claude Code (money logic) · **Date:** 2026-11-17

## The problem in plain English
Before this change, approving a payment always added the new period after the end of the business's current plan, whatever plan that was. Once Professional goes on sale:
- An Essentials customer with 300 days left who paid ₹599 for one month of Professional would have received **300 days + 1 month of Professional**.
- A Professional customer switching to Essentials would have lost value: Professional days would have become cheaper Essentials days one-for-one.

## The approved rule (decisions 2–4)
- **Same plan (renewal):** unchanged. The new period starts when the current one ends.
- **Different paid plan (upgrade or downgrade):** the unused days are converted **by money value** into days of the new plan, at the prices of the cycle being bought:
  - Monthly: Essentials ₹399, Professional ₹599. Yearly: ₹3,499 and ₹4,999.
  - The new plan starts on the day you approve, and the paid period is added on top.
  - Examples: 300 unused Essentials days become 199 Professional days, plus the paid month. 30 unused Professional days become 45 Essentials days, plus the paid month.
- **Nothing paid running** (trial, free, expired, suspended): the paid period starts now, as before.
- **No refunds and no part-payments.** The amount to pay is always the plan's list price, so the UPI QR flow does not change.
- **Rounding** always goes down, by at most 1 millisecond of value. The customer never gets more than they had, and loses essentially nothing.

## What changed
- New `lib/subscriptions/plan-change.ts`: the pure rule `computePlanPurchase`.
- `lib/actions/subscriptions/process-request.ts`: approval uses the rule on the locked business row; the audit entry records the conversion.
- `lib/actions/subscriptions/get-pending-requests.ts`: the admin list now includes `currentPlan` and `planChange` (kind, from plan, unused days, credited days, new expiry), for G2 to display before approving.
- Tests:
  - new `tests/unit/plan-change.test.ts` (7 tests);
  - new integration test 8 in `api009` (real upgrade, then downgrade, through the action; admin figures; audit);
  - new real-Postgres test 1b (8 approvals at the same moment convert exactly once).
- `ARCHITECTURE.md`: a new section.

**Nothing is on sale yet.** Professional stays not purchasable until G2 flips it together with the screens.

## Verification
- Gate (`typecheck`, `lint:ratchet`, `knip`, `test`, Turbopack `build`): all green. 240 files, 2,003 tests (12 skipped); lint 0/0.
- Real-Postgres suite (local Docker): 29/29, three runs in a row.
- No database migration.

## Left for G2 (Antigravity)
- Flip `PLAN_CATALOG.professional.purchasable`.
- Remove every "Coming soon" for Professional.
- Show the price on the website, upgrade modal and billing tab.
- Checkout shows the conversion before paying, using `computePlanPurchase` in the checkout page server.
- The admin approve dialog shows `planChange`.
- Upgrade links go to `/checkout?plan=professional`.
- E2E coverage.
