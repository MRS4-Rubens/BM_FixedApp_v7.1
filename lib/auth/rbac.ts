/** Application roles. MUST stay identical to `roleEnum` in lib/db/schema/enums.ts (enforced by tests/unit/rbac.test.ts). */
export const APP_ROLES = ['owner', 'staff', 'accountant'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Convention: owner-only actions pass exactly this constant as `roles` (the drift-guard test enforces it). */
export const OWNER_ONLY = ['owner'] as const satisfies readonly AppRole[];

/**
 * Feature B: roles that may CHANGE business data (create, edit, finalize, delete, record, send).
 * The read-only 'accountant' (CA) role is deliberately excluded. Convention: 'editor' actions pass exactly this
 * constant as `roles` (the drift-guard test enforces it). Actions without `roles` are open to EVERY role,
 * including the accountant, so they must only read.
 */
export const EDITOR_ROLES = ['owner', 'staff'] as const satisfies readonly AppRole[];

/** True for roles that may change business data (owner, staff); false for the read-only accountant. */
export function canEditBusinessData(role: unknown): boolean {
  return evaluateRoleAccess(role, EDITOR_ROLES).allowed;
}

export const FORBIDDEN_ROLE_CODE = 'FORBIDDEN_ROLE';
export const FORBIDDEN_ROLE_MESSAGE =
  'You do not have permission to do this. Please ask the account owner to perform this action.';

export type RoleDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'invalid_role' | 'role_not_permitted' };

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.some((role) => role === value);
}

/** Fail closed: anything that is not a known role is denied. An empty `allowed` list denies everyone. */
export function evaluateRoleAccess(role: unknown, allowed: readonly AppRole[]): RoleDecision {
  if (!isAppRole(role)) return { allowed: false, reason: 'invalid_role' };
  return allowed.includes(role) ? { allowed: true } : { allowed: false, reason: 'role_not_permitted' };
}

export function isOwnerRole(role: unknown): boolean {
  return isAppRole(role) && role === 'owner';
}

