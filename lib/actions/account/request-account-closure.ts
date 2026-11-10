'use server';

import { eq, and, gte, desc } from 'drizzle-orm';
import { OWNER_ONLY } from '@/lib/auth/rbac';
import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';
import { db } from '@/lib/db/client';
import { businesses, auditLog } from '@/lib/db/schema';
import { writeAudit } from '@/lib/audit/log';
import { getAuditRequestContext } from '@/lib/audit/request-context';
import { requestAccountClosureSchema } from '@/lib/validations/account-closure';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import { getResend } from '@/lib/email/resend';
import { getEmailEnv } from '@/lib/env';
import { SUPPORT_EMAIL } from '@/lib/config/contact';
import { getRequestSession } from '@/lib/auth/request-session';
import { formatIstDate, formatIstTime } from '@/lib/invoices/ist-date';
import { currentRequestId } from '@/lib/observability/request-context';

export const requestAccountClosureAction = createAuthenticatedAction(
  requestAccountClosureSchema,
  async (input, { appUser }) => {
    const businessId = appUser.business_id;
    if (!businessId) {
      throw new ActionError('No business linked to your account.', { code: 'NO_BUSINESS' });
    }

    // 1. Load the business profile
    const bizRows = await db
      .select({
        id: businesses.id,
        legal_name: businesses.legal_name,
        gstin: businesses.gstin,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    const business = bizRows[0];
    if (!business) {
      throw new ActionError('Business not found.', { code: 'NOT_FOUND' });
    }

    if (input.confirmation_gstin !== business.gstin) {
      throw new ActionError('The GSTIN you typed does not match this business.', {
        code: 'CLOSURE_CONFIRMATION_MISMATCH',
        fieldErrors: {
          confirmation_gstin: ['The GSTIN you typed does not match this business.'],
        },
      });
    }

    // 2. Duplicate guard: reject if closure was already requested in the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const existingAudit = await db
      .select({
        created_at: auditLog.created_at,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.business_id, business.id),
          eq(auditLog.action, 'account_closure_requested'),
          gte(auditLog.created_at, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(auditLog.created_at))
      .limit(1);

    if (existingAudit.length > 0 && existingAudit[0]) {
      const istDateStr = formatIstDate(existingAudit[0].created_at);
      throw new ActionError(
        `A closure request was already received on ${istDateStr}. Our team will contact you.`,
        { code: 'CLOSURE_ALREADY_REQUESTED' },
      );
    }

    // 3. Write audit log in ONE transaction
    const requestedAtDate = new Date();
    const requestContext = await getAuditRequestContext();

    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        businessId: business.id,
        actorUserId: appUser.id,
        entityType: 'business',
        entityId: business.id,
        action: 'account_closure_requested',
        requestContext,
        metadata: {
          reason: input.reason?.trim() || null,
        },
      });
    });

    // 4. AFTER the commit, send email notification via Resend
    const requestedAtIst = `${formatIstDate(requestedAtDate)} ${formatIstTime(requestedAtDate)} (IST)`;
    const reqId = currentRequestId() ?? 'N/A';
    const session = await getRequestSession();
    const userEmail = session?.data?.user?.email || 'N/A';
    const recipientEmail = SUPPORT_EMAIL;
    const fromEmail = getEmailEnv().RESEND_FROM_EMAIL;

    try {
      const emailText = [
        `Account Closure Request`,
        `=======================`,
        `Business ID: ${business.id}`,
        `Legal Name: ${business.legal_name}`,
        `GSTIN: ${business.gstin}`,
        `Requester Email: ${userEmail}`,
        `Requested At: ${requestedAtIst}`,
        `Request ID: ${reqId}`,
        `Reason: ${input.reason?.trim() || 'None provided'}`,
      ].join('\n');

      // Resend reports delivery problems in `result.error` instead of throwing (same handling as send-feedback).
      const result = await getResend().emails.send({
        from: fromEmail,
        to: recipientEmail,
        subject: `Account closure request — ${business.legal_name} (${business.gstin})`,
        text: emailText,
      });
      if (result.error) {
        logError('request-account-closure-email', result.error, { businessId: business.id });
      }
    } catch (error: unknown) {
      logError('request-account-closure-email', error, { businessId: business.id });
      // Still return success: the audit log entry is the statutory system of record
    }

    return {
      requestedAt: formatIstDate(requestedAtDate),
    };
  },
  'request-account-closure',
  {
    roles: OWNER_ONLY,
    rateLimit: {
      limiter: sensitiveActionLimiter,
      keyPrefix: 'account-closure',
      outage: 'fail-closed',
    },
  },
);

