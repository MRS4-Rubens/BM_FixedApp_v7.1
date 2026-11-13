import type { JsonValue } from './log';

/** Values are recorded (statutory identity / payee fields). */
const PROFILE_AUDIT_VALUE_FIELDS = [
  'legal_name', 'trade_name', 'gstin', 'registration_type', 'state_code',
  'bank_account_name', 'bank_ifsc', 'bank_name',
] as const;
/** Only the FACT of change is recorded (personal data must not enter an immutable log). */
const PROFILE_AUDIT_PRESENCE_FIELDS = [
  'pan', 'address_line1', 'address_line2', 'city', 'pincode', 'phone', 'email', 'alternate_phone', 'nature_of_business', 'invoice_tagline',
] as const;
/** Recorded as last-4 only, under the key bank_account_last4. */
const PROFILE_AUDIT_MASKED_FIELD = 'bank_account_number' as const;

const AUDITED_PROFILE_FIELDS = [
  ...PROFILE_AUDIT_VALUE_FIELDS,
  ...PROFILE_AUDIT_PRESENCE_FIELDS,
  PROFILE_AUDIT_MASKED_FIELD,
] as const;

export type AuditedProfileField = (typeof AUDITED_PROFILE_FIELDS)[number];
export type ProfileSnapshot = Readonly<Record<AuditedProfileField, string | null>>;

export interface ProfileAuditChanges {
  readonly changed_fields: readonly AuditedProfileField[];
  readonly changes: { readonly [key: string]: JsonValue };
}

function normalize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Last four non-space characters; fully masked when too short to reveal anything safely. */
export function lastFour(value: string | null): string | null {
  if (value === null) return null;
  const compact = value.replace(/\s+/g, '');
  return compact.length > 4 ? compact.slice(-4) : '****';
}

function isValueField(field: AuditedProfileField): boolean {
  return (PROFILE_AUDIT_VALUE_FIELDS as readonly string[]).includes(field);
}

/** Returns null when no audited field changed (callers then write NO audit row). */
export function buildProfileAuditChanges(previous: ProfileSnapshot, next: ProfileSnapshot): ProfileAuditChanges | null {
  const changedFields: AuditedProfileField[] = [];
  const changes: Record<string, JsonValue> = {};
  for (const field of AUDITED_PROFILE_FIELDS) {
    const before = normalize(previous[field]);
    const after = normalize(next[field]);
    if (before === after) continue;
    changedFields.push(field);
    if (field === PROFILE_AUDIT_MASKED_FIELD) {
      changes.bank_account_last4 = { from: lastFour(before), to: lastFour(after) };
    } else if (isValueField(field)) {
      changes[field] = { from: before, to: after };
    }
  }
  return changedFields.length === 0 ? null : { changed_fields: changedFields, changes };
}

