'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { ActionError } from '@/lib/actions/_shared/errors';
import { sensitiveActionLimiter } from '@/lib/rate-limit/upstash';
import {
  sendFeedbackSchema,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_SIZE_BYTES,
} from '@/lib/validations/feedback';
import { getRequestSession } from '@/lib/auth/request-session';
import { db } from '@/lib/db/client';
import { businesses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getResend } from '@/lib/email/resend';
import { getEmailEnv } from '@/lib/env';
import { FeedbackNotificationEmail } from '@/lib/email/templates/feedback-notification-email';
import { logError } from '@/lib/actions/_shared/logger';
import { FEEDBACK_RECIPIENT_EMAIL } from '@/lib/config/contact';
import {
  requireValidUpload,
  makeAttachmentFilenames,
  IMAGE_AND_PDF_MIMES,
} from '@/lib/security/upload';

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug Report',
  feature_request: 'Feature Request',
  ui_ux: 'UI / UX Improvement',
  general: 'General Feedback',
};

export const sendFeedbackAction = createAuthenticatedAction(
  sendFeedbackSchema,
  async (input, { appUser }) => {
    // 1. Retrieve the authenticated user's session email
    const session = await getRequestSession();
    const userEmail = session?.data?.user?.email;

    if (!userEmail) {
      throw new ActionError(
        'Could not identify your account email. Please log in again to submit feedback.',
        { code: 'AUTH_REQUIRED' }
      );
    }

    // 2. Fetch business details if the user has an associated business
    let businessName = 'No Business Configured';
    let businessGstin: string | null = null;

    if (appUser.business_id) {
      const bizRows = await db
        .select({
          legalName: businesses.legal_name,
          tradeName: businesses.trade_name,
          gstin: businesses.gstin,
        })
        .from(businesses)
        .where(eq(businesses.id, appUser.business_id))
        .limit(1);

      if (bizRows[0]) {
        businessName = bizRows[0].tradeName || bizRows[0].legalName;
        businessGstin = bizRows[0].gstin;
      }
    }

    const categoryLabel = CATEGORY_LABELS[input.category] || 'Feedback';

    // 3. Convert Base64 attachments into validated, sanitised in-memory buffers (Zero DB/S3 writes)
    const validated = input.attachments.map((file) => ({
      file,
      upload: requireValidUpload(file.contentBase64, {
        maxBytes: MAX_FILE_SIZE_BYTES,
        allowed: IMAGE_AND_PDF_MIMES,
      }),
    }));
    const totalBytes = validated.reduce((sum, item) => sum + item.upload.sizeBytes, 0);
    if (totalBytes > MAX_TOTAL_SIZE_BYTES) {
      throw new ActionError('Total combined attachment size must be 10 MB or smaller.', {
        code: 'FILE_TOO_LARGE',
      });
    }
    const attachmentNames = makeAttachmentFilenames(
      validated.map((item) => ({ original: item.file.filename, ext: item.upload.ext }))
    );
    const emailAttachments = validated.map((item, index) => ({
      filename: attachmentNames.at(index) ?? `attachment-${index + 1}.${item.upload.ext}`,
      content: item.upload.buffer,
      contentType: item.upload.mime,
    }));

    // 4. Determine sender and recipient addresses
    const recipientEmail = FEEDBACK_RECIPIENT_EMAIL;
    const fromEmail = getEmailEnv().RESEND_FROM_EMAIL;

    // Format the Reply-To address with the user's name if available
    const replyToAddress = appUser.display_name
      ? `"${appUser.display_name}" <${userEmail}>`
      : userEmail;

    // 5. Send notification email via Resend
    try {
      const result = await getResend().emails.send({
        from: fromEmail,
        to: recipientEmail,
        replyTo: replyToAddress,
        subject: `[Bill Matrix Feedback - ${categoryLabel}] ${input.title}`,
        react: FeedbackNotificationEmail({
          category: input.category,
          categoryLabel,
          severity: input.severity,
          rating: input.rating,
          title: input.title,
          description: input.description,
          userName: appUser.display_name || 'Bill Matrix User',
          userEmail,
          userRole: appUser.role,
          businessName,
          businessGstin,
          diagnostics: input.diagnostics,
          attachmentNames,
        }),
        attachments: emailAttachments,
      });

      if (result.error) {
        logError('send-feedback', result.error);
        throw new ActionError(
          'We could not send your feedback right now. Please try again.',
          { code: 'EMAIL_SEND_FAILED' }
        );
      }

      return {
        message: 'Thank you! Your feedback has been sent directly to the development team.',
        recipient: recipientEmail,
      };
    } catch (err: unknown) {
      if (err instanceof ActionError) throw err;
      logError('send-feedback', err);
      throw new ActionError(
        'An unexpected error occurred while sending your feedback. Please check your internet connection and try again.',
        { code: 'INTERNAL_ERROR' }
      );
    }
  },
  'send-feedback',
  {
    rateLimit: {
      limiter: sensitiveActionLimiter,
      keyPrefix: 'feedback',
      outage: 'fail-closed',
    },
  }
);
