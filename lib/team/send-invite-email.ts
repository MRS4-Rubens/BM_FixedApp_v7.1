import * as React from 'react';
import { getResend } from '@/lib/email/resend';
import { getAppEnv, getEmailEnv } from '@/lib/env';
import { TeamInviteEmail } from '@/lib/email/templates/team-invite-email';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { logError } from '@/lib/actions/_shared/logger';
import { toLoggableError } from '@/lib/actions/_shared/action-error-mapping';
import { buildInvitePath } from '@/lib/team/invite-format';
import type { InvitableRole } from '@/lib/db/domain-values';

export function buildInviteUrl(token: string): string {
  return `${getAppEnv().NEXT_PUBLIC_APP_URL}${buildInvitePath(token)}`;
}

/**
 * Sends the invite e-mail. Never throws: the invite row is already committed, and the owner can still share the
 * returned link or press Resend. The raw token is never logged.
 */
export async function sendTeamInviteEmail(input: {
  readonly to: string;
  readonly businessName: string;
  readonly inviterName: string;
  readonly inviteUrl: string;
  readonly expiresAt: Date;
  readonly invitationId: string;
  readonly role: InvitableRole;
}): Promise<boolean> {
  try {
    const result = await getResend().emails.send({
      from: getEmailEnv().RESEND_FROM_EMAIL,
      to: [input.to],
      subject: `${input.inviterName} invited you to join ${input.businessName} on Invoice BizFolio`,
      react: React.createElement(TeamInviteEmail, {
        businessName: input.businessName,
        inviterName: input.inviterName,
        inviteUrl: input.inviteUrl,
        expiresOn: formatIstDate(input.expiresAt, { day: 'numeric', month: 'short', year: 'numeric' }),
        role: input.role,
      }),
    });
    if (result.error) {
      logError('team-invite-email', toLoggableError(result.error), { invitationId: input.invitationId });
      return false;
    }
    return true;
  } catch (error: unknown) {
    logError('team-invite-email', error, { invitationId: input.invitationId });
    return false;
  }
}
