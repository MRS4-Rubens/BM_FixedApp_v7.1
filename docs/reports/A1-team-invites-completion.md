# A1 — Team invites backend (feature A: Team members and roles)

**Branch:** `feat/team-invites` · **Built by:** Claude Code (route: long + complex auth work, built here) · **Date:** 2026-11-16

## What it does
A business owner can invite people by e-mail to work in the business as **staff**. The invited person opens the
link, signs in or creates an account with that same (verified) e-mail, and joins. The owner can resend or cancel
invites and remove staff. Seat limits per plan are enforced. The Users & Roles screen itself is **A2**.

## Approved decisions applied (see memory `team-feature`)
| # | Decision | Where |
|---|---|---|
| 1 | Free 1 · Trial/Essentials 3 · Professional unlimited (members + open invites hold seats) | `lib/team/seats.ts`, existing `teamUserLimit` |
| 2 | E-mail link, 7 days, single use, only the invited verified e-mail; resend rotates the token; cancel | `lib/team/invite-*.ts`, actions |
| 3 | One account = one business; refused at ACCEPT (owners cannot probe who has an account) | `lib/team/accept-rules.ts` |
| 4 | Staff permissions = existing owner / any-member split | unchanged `ACTION_ACCESS` |
| 5 | Remove = unlink (business_id null, role back to the default 'owner'); account and history kept | `remove-team-member.ts` |
| 6 | Over the limit after downgrade/expiry: nobody removed; new invites and joins blocked; `getTeam.seats.overLimit` | `seats.ts`, `get-team.ts` |
| 7 | No ownership transfer (only 'staff' is invitable; DB CHECK enforces it) | `INVITABLE_ROLES`, migration |

## Files
**New**
- `drizzle/0034_team_invitations.sql` (+ snapshot): `business_invitations` table, one-open-invite-per-email partial unique index, CHECKs (status, role, normalised e-mail, accept/revoke field consistency).
- `lib/db/schema/business_invitations.ts`
- `lib/team/invite-token.ts` (server: random 256-bit token, SHA-256 hash), `lib/team/invite-format.ts` (client-safe: shape check, expiry, e-mail normalise/mask, path)
- `lib/team/seats.ts`, `lib/team/accept-rules.ts` (pure rules shared by page + action)
- `lib/team/team-db.ts` (business row lock, seat counting), `lib/team/send-invite-email.ts`, `lib/team/pending-invite-cookie.ts`
- `lib/actions/team/`: `invite-team-member`, `resend-team-invite`, `revoke-team-invite`, `remove-team-member`, `get-team`, `accept-team-invite`
- `lib/validations/team.ts`, `lib/email/templates/team-invite-email.tsx`
- `app/invite/[token]/page.tsx`, `app/invite/[token]/invite-actions.tsx`, `app/invite/[token]/continue/route.ts`
- `tests/unit/team-invite-rules.test.ts` (16), `tests/integration/team-invites.test.ts` (18, PGlite, all migrations)

**Changed**
- `lib/auth/action-permissions.ts`: 6 team scopes; new access kind `'signed-in'` (accept works for an account without a business). `tests/unit/action-permissions.test.ts` checks it.
- `lib/audit/log.ts`: entity `team` with `invite_create`, `invite_resend`, `invite_revoke`, `member_join`, `member_remove`.
- `lib/db/domain-values.ts`: `INVITATION_STATUSES`, `INVITABLE_ROLES`. `lib/db/schema/index.ts`: export.
- `app/(auth)/login/actions.ts`, `app/(auth)/signup/actions.ts`: after success, go back to a still-open remembered invite instead of `/dashboard`.

## Security and integrity
- Only the token **hash** is stored; links can't be rebuilt from a database copy. Tokens are 256-bit random.
- Every seat decision runs under `SELECT … FOR UPDATE` on the business row. Lock order is always business → invitation → user (no deadlocks).
- Accept links the user only `WHERE business_id IS NULL`, so double clicks or two tabs can't link twice (tested with two parallel accepts: exactly one wins).
- E-mail must match the invite AND be verified (same rule as platform-admin access).
- The invite page shows the invited address **masked**; it is `noindex`; it is outside the auth proxy because the invitee may have no account.
- The remembered-invite cookie is httpOnly, SameSite=Lax, Secure in production, **one-shot**, and only honoured while the invite is still open (no stale redirects, no open redirect).
- Owner actions are `OWNER_ONLY`; cross-business access returns NOT_FOUND (tested). Rate limits: invites/resends share a fail-closed limiter; resend has a 60 s cooldown.
- A failed e-mail never loses the invite: the action returns `emailSent: false` plus the link (owner-only) to share manually.

## Verification
- `pnpm typecheck` ✅ · `pnpm lint:ratchet` ✅ 0/0 · `pnpm knip` ✅ · `pnpm db:check` ✅
- `pnpm test` ✅ 224 files / 1877 tests (34 new team tests: 16 unit + 18 integration)
- `pnpm build` (Turbopack) ✅, routes `/invite/[token]` and `/invite/[token]/continue`
- Migration 0034 applied to **bm_dev**.
- Live check on the dev server: signed-out invite page (masked e-mail, expiry, buttons), invalid link page, continue route (307 + httpOnly cookie), "Log in to accept" opens the normal login popup (social buttons untouched). The temporary test invite was deleted afterwards.

## Not covered here (by design)
- **The signed-in accept click in a real browser** was not run: it needs a second real, e-mail-verified account on the hosted sign-in service. The full accept logic is covered by the integration tests; A2's Playwright E2E (CI, `E2E_VERIFY_MODE=db`) will run the real owner → invite → staff join journey.
- **Users & Roles UI**, staff-view clean-up across the app, and flipping the "Coming soon" pills: **A2**.
- "Change role": deferred to **B** (CA role), because only 'staff' can be assigned today.

## Notes for A2
- Use `getTeam` for the tab. It returns `members`, `invites` (`isExpired`), `seats {used, limit, members, openInvites, overLimit}`, `canInvite`, `cannotInviteReason`.
- After `inviteTeamMember` / `resendTeamInvite`, show "Copy invite link" (from `inviteUrl`) and warn when `emailSent` is false.
- Staff currently still see owner-only buttons, which fail safely with FORBIDDEN_ROLE. A2 must hide them, and must hide the Users & Roles tab for staff.
