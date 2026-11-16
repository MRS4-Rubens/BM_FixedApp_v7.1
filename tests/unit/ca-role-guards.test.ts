import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_ACCESS } from '@/lib/auth/action-permissions';
import { APP_ROLES, EDITOR_ROLES, canEditBusinessData, evaluateRoleAccess } from '@/lib/auth/rbac';
import { evaluateRoleGrant, teamRoleLabel } from '@/lib/team/role-rules';
import { roleLabel } from '@/components/app/current-user-role';

/** Feature B: the read-only accountant (CA) role must never reach a data-changing action or page. */

function scopesWith(access: string): string[] {
  return Object.entries(ACTION_ACCESS)
    .filter(([, value]) => value === access)
    .map(([scope]) => scope);
}

const ACTION_FILES: string[] = readdirSync('lib/actions', { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.ts'))
  .map((name) => join('lib/actions', name));

/** The action file whose createAuthenticatedAction/createAction call is registered under `scope`. */
function fileForScope(scope: string): string {
  const scopeArgument = new RegExp(`'${scope}'\\s*,\\s*\\{|'${scope}'\\s*,?\\s*\\)`);
  const file = ACTION_FILES.find((candidate) => scopeArgument.test(readFileSync(candidate, 'utf8')));
  if (!file) throw new Error(`no action file for ${scope}`);
  return file;
}

describe('accountant role (feature B)', () => {
  it('accountant is a real role but not an editor', () => {
    expect(APP_ROLES).toContain('accountant');
    expect(EDITOR_ROLES).toEqual(['owner', 'staff']);
    expect(canEditBusinessData('owner')).toBe(true);
    expect(canEditBusinessData('staff')).toBe(true);
    expect(canEditBusinessData('accountant')).toBe(false);
    expect(canEditBusinessData('ACCOUNTANT')).toBe(false);
    expect(canEditBusinessData(undefined)).toBe(false);
    expect(evaluateRoleAccess('accountant', EDITOR_ROLES)).toEqual({ allowed: false, reason: 'role_not_permitted' });
  });

  it('the 16 data-changing day-to-day actions are editor-only', () => {
    const editors = scopesWith('editor').sort();
    expect(editors).toEqual(
      [
        'create-customer',
        'create-product',
        'deactivate-customer',
        'deactivate-product',
        'delete-credit-note-draft',
        'delete-invoice-draft',
        'email-invoice',
        'finalize-invoice',
        'reactivate-customer',
        'reactivate-product',
        'record-payment',
        'save-credit-note-draft',
        'save-invoice-draft',
        'send-payment-reminder',
        'update-customer',
        'update-product',
      ].sort(),
    );
  });

  it("every 'any-member' action (open to the accountant) only reads", () => {
    const WRITE = /\.insert\(|\.update\(|\.delete\(|writeAudit\(|recomputePaymentStatus|uploadFileToStorage/;
    // send-feedback e-mails the platform support inbox; it changes no business data.
    const allowed = new Set(['send-feedback']);
    for (const scope of scopesWith('any-member')) {
      if (allowed.has(scope)) continue;
      const source = readFileSync(fileForScope(scope), 'utf8');
      expect(WRITE.test(source), `'${scope}' is open to the read-only accountant but appears to write data`).toBe(false);
    }
  });

  it('every create / edit page sends the accountant away server-side', () => {
    const pages = [
      'app/(app)/invoices/new/page.tsx',
      'app/(app)/invoices/[id]/credit-note/new/page.tsx',
      'app/(app)/customers/new/page.tsx',
      'app/(app)/customers/[id]/edit/page.tsx',
      'app/(app)/products/new/page.tsx',
      'app/(app)/products/[id]/edit/page.tsx',
    ];
    for (const page of pages) {
      expect(readFileSync(page, 'utf8'), `${page} must call redirectReadOnlyRole`).toMatch(/redirectReadOnlyRole\(appUser\.role,/);
    }
  });

  it('the accountant role needs Professional to be granted; staff never does', () => {
    expect(evaluateRoleGrant('accountant', { canUseAccountantRole: false }).allowed).toBe(false);
    expect(evaluateRoleGrant('accountant', { canUseAccountantRole: true }).allowed).toBe(true);
    expect(evaluateRoleGrant('staff', { canUseAccountantRole: false }).allowed).toBe(true);
  });

  it('labels', () => {
    expect(roleLabel('accountant')).toBe('Accountant (read-only)');
    expect(roleLabel('staff')).toBe('Team member');
    expect(roleLabel('owner')).toBe('Owner');
    expect(teamRoleLabel('accountant')).toBe('Accountant (read-only)');
  });
});
