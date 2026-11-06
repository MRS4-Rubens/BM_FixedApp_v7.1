import { getPgError } from '@/lib/db/pg-error';

export const GSTIN_UNIQUE_CONSTRAINT = 'businesses_gstin_unique';
export const IDENTITY_FIELDS = ['gstin', 'state_code'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export interface BusinessIdentity {
  readonly gstin: string;
  readonly state_code: string;
}

export type IdentityChange =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'changed'; readonly fields: readonly IdentityField[] };

/** Trim + uppercase compare. Never throws. */
export function diffBusinessIdentity(current: BusinessIdentity, next: BusinessIdentity): IdentityChange {
  const curGstin = (current?.gstin ?? '').trim().toUpperCase();
  const nextGstin = (next?.gstin ?? '').trim().toUpperCase();
  const curState = (current?.state_code ?? '').trim().toUpperCase();
  const nextState = (next?.state_code ?? '').trim().toUpperCase();

  const fields: IdentityField[] = [];
  if (curGstin !== nextGstin) {
    fields.push('gstin');
  }
  if (curState !== nextState) {
    fields.push('state_code');
  }

  if (fields.length === 0) {
    return { kind: 'unchanged' };
  }

  return { kind: 'changed', fields };
}

export function isGstinUniqueViolation(error: unknown): boolean {
  const pg = getPgError(error);
  return pg.code === '23505' && pg.constraint === GSTIN_UNIQUE_CONSTRAINT;
}

export function buildGstinTakenMessage(): string {
  return 'This GSTIN is already registered on Bill Matrix. If you own it, contact support with proof of ownership.';
}

export function buildIdentityLockedMessage(supportEmail: string): string {
  return `GSTIN and registered state cannot be changed after invoices have been finalized. Please contact ${supportEmail} to request a change.`;
}

