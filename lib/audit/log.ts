import type { DbTransaction } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema';

/**
 * Statutory audit trail (DB-007). The table is append-only at the database level (trigger bm_audit_log_guard).
 * Every entry is written INSIDE the business transaction, after the guarded mutation, with the SAME tx:
 * no audit row => no business change. Existing (entity, action) pairs are frozen for history continuity.
 */
export const AUDIT_EVENTS = {
  invoice: ['finalize'],
  credit_note: ['finalize', 'void'],
  payment: ['record', 'void', 'record_refund'],
  business: [
    'profile_create',
    'profile_update',
    'logo_upload',
    'logo_remove',
    'signature_upload',
    'signature_remove',
    'subscription_manual_override',
    'business_identity_changed',
    'business_identity_changed_by_admin',
    'data_export',
    'account_closure_requested',
  ],
  subscription_request: ['approve', 'reject'],
  // Feature A (team members): entity_id is the invitation id for invite_*, the member's users.id for member_*.
  team: ['invite_create', 'invite_resend', 'invite_revoke', 'member_join', 'member_remove', 'member_role_change'],
} as const;

export type AuditEntityType = keyof typeof AUDIT_EVENTS;
export type AuditActionFor<E extends AuditEntityType> = (typeof AUDIT_EVENTS)[E][number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type AuditMetadata = { readonly [key: string]: JsonValue };

export interface AuditRequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}
export const NO_AUDIT_REQUEST_CONTEXT: AuditRequestContext = { ip: null, userAgent: null };

export interface AuditEntry<E extends AuditEntityType> {
  readonly businessId: string;
  /** null only for system actors (tests, future cron). */
  readonly actorUserId: string | null;
  readonly entityType: E;
  readonly entityId: string;
  readonly action: AuditActionFor<E>;
  readonly metadata: AuditMetadata;
  readonly requestContext: AuditRequestContext;
}

export class AuditWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditWriteError';
  }
}

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;
const MAX_USER_AGENT_CHARS = 512;
const MAX_METADATA_JSON_CHARS = 16_384;
const MAX_METADATA_DEPTH = 6;
// Keys that must never be persisted into an immutable log. (Masked bank data uses the key bank_account_last4.)
const FORBIDDEN_KEY_PATTERN = /password|secret|token|authorization|cookie|api[_-]?key|account[_-]?number/i;

/** First hop of a forwarded-for list, accepted only if it looks like an IPv4/IPv6 literal; otherwise null. */
export function sanitizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim() ?? '';
  return IP_PATTERN.test(first) ? first : null;
}

export function sanitizeUserAgent(value: string | null | undefined): string | null {
  if (!value) return null;
  let cleaned = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    cleaned += (code < 32 || code === 127) ? ' ' : (value[i] ?? '');
  }
  const trimmed = cleaned.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_USER_AGENT_CHARS ? trimmed.slice(0, MAX_USER_AGENT_CHARS) : trimmed;
}

function assertSafeValue(value: JsonValue, path: string, depth: number): void {
  if (depth > MAX_METADATA_DEPTH) throw new AuditWriteError(`audit metadata too deep at ${path}`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AuditWriteError(`audit metadata has a non-finite number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) throw new AuditWriteError(`audit metadata key not allowed: ${path}.${key}`);
    assertSafeValue(nested, `${path}.${key}`, depth + 1);
  }
}

/** Throws AuditWriteError (a programmer error, never shown to users) if metadata is unsafe or oversized. */
export function assertSafeMetadata(metadata: AuditMetadata): void {
  assertSafeValue(metadata, 'metadata', 0);
  if (JSON.stringify(metadata).length > MAX_METADATA_JSON_CHARS) {
    throw new AuditWriteError('audit metadata exceeds the size limit');
  }
}

export async function writeAudit<E extends AuditEntityType>(tx: DbTransaction, entry: AuditEntry<E>): Promise<void> {
  assertSafeMetadata(entry.metadata);
  await tx.insert(auditLog).values({
    business_id: entry.businessId,
    user_id: entry.actorUserId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    metadata: entry.metadata,
    ip: sanitizeIp(entry.requestContext.ip),
    user_agent: sanitizeUserAgent(entry.requestContext.userAgent),
  });
}

