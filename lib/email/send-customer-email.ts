import type * as React from 'react';
import { ActionError } from '@/lib/actions/_shared/errors';
import { toLoggableError } from '@/lib/actions/_shared/action-error-mapping';
import { logError } from '@/lib/actions/_shared/logger';
import { getMailer } from '@/lib/email/mailer';
import { getEmailEnv } from '@/lib/env';
import { buildListUnsubscribeHeader } from '@/lib/email/send-policy';

export interface SendCustomerEmailParams {
  readonly kind: 'invoice' | 'reminder';
  readonly invoiceId: string;
  readonly claimedAt: Date;
  readonly to: string;
  readonly subject: string;
  readonly react: React.ReactElement;
  readonly senderContactEmail: string | null;
  readonly attachments?: ReadonlyArray<{ readonly filename: string; readonly content: Buffer }>;
}

const EMAIL_SEND_FAILED_MESSAGE = 'We could not send the e-mail. Please try again.';

export async function sendCustomerEmail(params: SendCustomerEmailParams): Promise<void> {
  const from = getEmailEnv().EMAIL_FROM;
  const listUnsubHeaders = buildListUnsubscribeHeader(params.senderContactEmail);

  const cleanSenderEmail = params.senderContactEmail?.trim();
  const hasValidSenderEmail =
    cleanSenderEmail &&
    !cleanSenderEmail.includes(' ') &&
    !cleanSenderEmail.includes(',') &&
    cleanSenderEmail.includes('@') &&
    cleanSenderEmail.includes('.');

  const idempotencyKey = `${params.kind}:${params.invoiceId}:${params.claimedAt.toISOString()}`;

  let resultError: { message?: string; name?: string } | null = null;

  try {
    const response = await getMailer().emails.send(
      {
        from,
        to: params.to,
        subject: params.subject,
        react: params.react,
        ...(hasValidSenderEmail ? { replyTo: cleanSenderEmail } : {}),
        ...(Object.keys(listUnsubHeaders).length > 0 ? { headers: listUnsubHeaders } : {}),
        ...(params.attachments && params.attachments.length > 0
          ? {
              attachments: params.attachments.map((att) => ({
                filename: att.filename,
                content: att.content,
              })),
            }
          : {}),
      },
      { idempotencyKey },
    );

    resultError = response.error;
  } catch (caught: unknown) {
    logError('customer-email', toLoggableError(caught), {
      kind: params.kind,
      invoiceId: params.invoiceId,
    });
    throw new ActionError(EMAIL_SEND_FAILED_MESSAGE, { code: 'EMAIL_SEND_FAILED' });
  }

  if (resultError !== null && resultError !== undefined) {
    logError('customer-email', new Error(resultError.message ?? 'E-mail provider rejected the dispatch'), {
      kind: params.kind,
      invoiceId: params.invoiceId,
      providerErrorName: resultError.name,
    });
    throw new ActionError(EMAIL_SEND_FAILED_MESSAGE, { code: 'EMAIL_SEND_FAILED' });
  }
}

