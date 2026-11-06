import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  OWNER_ONLY,
  evaluateRoleAccess,
  isAppRole,
  isOwnerRole,
  type AppRole,
} from '@/lib/auth/rbac';
import { roleEnum } from '@/lib/db/schema/enums';

describe('RBAC pure helpers (lib/auth/rbac.ts)', () => {
  it('enforces enum parity with PostgreSQL schema roleEnum', () => {
    const rbacRoles = [...APP_ROLES].sort();
    const schemaRoles = [...roleEnum.enumValues].sort();
    expect(rbacRoles).toEqual(schemaRoles);
  });

  describe('isAppRole', () => {
    it('returns true for all valid application roles', () => {
      for (const role of APP_ROLES) {
        expect(isAppRole(role)).toBe(true);
      }
    });

    it('returns false for invalid role values', () => {
      const invalidValues: readonly unknown[] = [
        undefined,
        null,
        '',
        'OWNER',
        'STAFF',
        'admin',
        'superuser',
        42,
        true,
        {},
        [],
      ];
      for (const value of invalidValues) {
        expect(isAppRole(value)).toBe(false);
      }
    });
  });

  describe('isOwnerRole', () => {
    it('returns true for owner role only', () => {
      expect(isOwnerRole('owner')).toBe(true);
    });

    it('returns false for staff and non-owner values', () => {
      const nonOwnerValues: readonly unknown[] = [
        'staff',
        undefined,
        null,
        '',
        'OWNER',
        'admin',
        42,
        {},
      ];
      for (const value of nonOwnerValues) {
        expect(isOwnerRole(value)).toBe(false);
      }
    });
  });

  describe('evaluateRoleAccess', () => {
    it('allows owner with OWNER_ONLY', () => {
      const decision = evaluateRoleAccess('owner', OWNER_ONLY);
      expect(decision).toEqual({ allowed: true });
    });

    it('denies staff with OWNER_ONLY with role_not_permitted reason', () => {
      const decision = evaluateRoleAccess('staff', OWNER_ONLY);
      expect(decision).toEqual({ allowed: false, reason: 'role_not_permitted' });
    });

    it('allows staff when staff is in the allowed list', () => {
      const decision = evaluateRoleAccess('staff', ['owner', 'staff']);
      expect(decision).toEqual({ allowed: true });
    });

    it('denies invalid or unknown roles with invalid_role reason', () => {
      const invalidRoles: readonly unknown[] = [
        undefined,
        null,
        '',
        'OWNER',
        'admin',
        42,
        {},
        false,
      ];
      for (const role of invalidRoles) {
        const decision = evaluateRoleAccess(role, OWNER_ONLY);
        expect(decision).toEqual({ allowed: false, reason: 'invalid_role' });
      }
    });

    it('denies both roles when the allowed list is empty', () => {
      const emptyAllowed: readonly AppRole[] = [];
      expect(evaluateRoleAccess('owner', emptyAllowed)).toEqual({
        allowed: false,
        reason: 'role_not_permitted',
      });
      expect(evaluateRoleAccess('staff', emptyAllowed)).toEqual({
        allowed: false,
        reason: 'role_not_permitted',
      });
    });
  });
});

