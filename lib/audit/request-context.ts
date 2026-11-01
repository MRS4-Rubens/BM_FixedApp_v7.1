import { headers } from 'next/headers';
import { NO_AUDIT_REQUEST_CONTEXT, sanitizeIp, sanitizeUserAgent, type AuditRequestContext } from './log';

/**
 * Best-effort network context for an audit row. Call it in the Server Action BEFORE opening the transaction
 * (never inside a retried transaction). Never throws: outside a request scope (tests, scripts) it returns
 * an empty context so an audit row can never block a financial action. x-forwarded-for is forensic context,
 * not proof of origin (hardening is SEC-005). Intentionally does not import the rate-limit module.
 */
export async function getAuditRequestContext(): Promise<AuditRequestContext> {
  try {
    const requestHeaders = await headers();
    return {
      ip: sanitizeIp(requestHeaders.get('x-forwarded-for') ?? requestHeaders.get('x-real-ip')),
      userAgent: sanitizeUserAgent(requestHeaders.get('user-agent')),
    };
  } catch {
    return NO_AUDIT_REQUEST_CONTEXT;
  }
}

