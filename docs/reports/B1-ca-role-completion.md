# B1 — Read-only accountant (CA) role: backend (feature B)

**Branch:** `feat/ca-role` · **Built by:** Claude Code (route: access control, built here) · **Date:** 2026-11-16

## What it does
A business on the **Professional** plan can give its CA a login with role **`accountant`**: they can view and export
everything, and change nothing. B1 is the server side; the screens (role picker, change-role control, hiding
buttons for the CA, plan pill) are **B2**.

## Approved decisions applied (memory `ca-role-feature`)
| # | Decision | Where |
|---|---|---|
| 1 | Professional only (switches on when Professional launches, step G) | `canUseAccountantRole` entitlement; `lib/team/role-rules.ts` |
| 2 | A CA counts as a user/seat | unchanged seat logic (`lib/team/seats.ts`) |
| 3 | View + export everything; no create / edit / finalize / delete / record / e-mail | `EDITOR_ROLES` on 16 actions; page guards |
| 4 | One account = one business stays | unchanged accept rules |
| 5 | Owner can switch staff ↔ accountant | new `change-team-member-role` |
| 6 | Leaving Professional: an existing CA keeps read access; no new CA invites, resends, joins or role grants | `evaluateRoleGrant` in invite / resend / accept / change-role |

## Why this mattered
Before B1, every "any member" action allowed **any** role. Adding a third role would silently have let a CA run
16 data-changing actions. B1 splits them:
- **`editor`** (owner and staff, `roles: EDITOR_ROLES`), 16 actions:
  - **invoices and payments:** save / delete invoice draft, finalize invoice, email invoice, payment reminder, record payment;
  - **credit notes:** save / delete credit-note draft;
  - **customers and products:** create / update / deactivate / reactivate, for each.
- **`any-member`** (every role including the CA, read-only), 24 actions: lists, details, PDFs, all reports and exports, send feedback.

## Files
**New:**
- `drizzle/0035_ca_role.sql` (+ snapshot): `ALTER TYPE role ADD VALUE 'accountant'`; `business_invitations_role_valid` now allows `staff`, `accountant`.
- `lib/auth/page-guards.ts`: `redirectReadOnlyRole`.
- `lib/team/role-rules.ts`: `evaluateRoleGrant`, `teamRoleLabel`.
- `lib/actions/team/change-team-member-role.ts`.
- Tests: `tests/unit/ca-role-guards.test.ts` (6) and `tests/integration/ca-role.test.ts` (7, PGlite, all migrations).

**Changed:**
- `lib/auth/rbac.ts`: `APP_ROLES` + `accountant`; `EDITOR_ROLES`; `canEditBusinessData`.
- `lib/db/schema/enums.ts`, `lib/db/domain-values.ts` (`INVITABLE_ROLES`).
- `lib/auth/action-permissions.ts`: new access kind `editor`; 16 scopes reclassified; `change-team-member-role` is owner-only.
- 16 action files: `roles: EDITOR_ROLES`.
- 6 create/edit pages (invoices/new, invoices/[id]/credit-note/new, customers/new, customers/[id]/edit, products/new, products/[id]/edit): the accountant is redirected to the list page.
- `lib/subscriptions/entitlements.ts`: `canUseAccountantRole` (Professional). The stale "RESERVED" comment on `teamUserLimit` is fixed.
- Team actions:
  - **invite, resend, accept:** the Professional check for accountant;
  - **remove:** any non-owner;
  - **get-team:** returns `canInviteAccountant`;
  - **audit:** new `team.member_role_change`.
- Invite e-mail and invite page: role-specific wording (the CA is told it is read-only).
- `components/app/current-user-role.tsx`: `roleLabel('accountant')` returns "Accountant (read-only)".
- Tests adjusted:
  - `tests/unit/action-permissions.test.ts`: new `editor` case;
  - `tests/unit/clean002-flag-enforcement.test.ts`: new flag mapping, and `teamUserLimit` is no longer reserved;
  - 4 integration mocks now give the fake signed-in user `role: 'owner'`. Editor actions fail closed on a missing role, which is correct;
  - `tests/realdb/helpers` role types.

## Guards that stop regressions
- **Drift test:** every `editor` action must pass exactly `EDITOR_ROLES`.
- **`ca-role-guards` test:**
  - the 16-action editor list is pinned;
  - every `any-member` action file is scanned for write calls (`insert` / `update` / `delete` / `writeAudit` / `recomputePaymentStatus` / uploads), with only `send-feedback` allowed;
  - all 6 create/edit pages must call `redirectReadOnlyRole`.

## Verification
- `pnpm typecheck` ✅ · `pnpm lint:ratchet` ✅ 0/0 · `pnpm knip` ✅ · `pnpm db:check` ✅ · `pnpm build` (Turbopack) ✅
- `pnpm test` ✅ 228 files / 1906 tests (13 new)
- Migration 0035 applied to **bm_dev**: the enum is now `{owner,staff,accountant}` and the invite role check allows staff and accountant.
- **Live check:** the dev account was temporarily set to `accountant`, then restored to `owner` and confirmed.
  - `/invoices/new`, `/customers/new` and `/products/new` bounce to their list pages; `/reports` opens.
  - As owner again, `/customers/new` opens the form.

## Left for B2 (UI)
- Role picker in the invite form ("Team member" / "Accountant (read-only)", disabled with a Professional hint when `canInviteAccountant` is false); change-role control in the member list.
- Accountant view:
  - hide New / Edit / Delete / Finalize / Record payment / Email / WhatsApp / Payment-reminder / Create-credit-note buttons;
  - a draft invoice or credit note must open read-only (today the form shows and its save is refused);
  - settings tabs as for staff.
- Admin console role filter: offer "accountant".
- Flip "Read-only access for your CA" to included (Professional stays not purchasable).
- E2E: admin sets the journey business to Professional → owner invites a CA → CA can open reports and exports but no create pages.
