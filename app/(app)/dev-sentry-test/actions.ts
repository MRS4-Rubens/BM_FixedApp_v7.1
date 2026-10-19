'use server';

import { ActionError } from '@/lib/actions/_shared/errors';
import { logError } from '@/lib/actions/_shared/logger';

export async function testServerAction() {
  if (process.env.NODE_ENV === 'production') {
    throw new ActionError('Not available in production.', { code: 'FORBIDDEN' });
  }

  try {
    throw new Error('This is a test Server Action error for Sentry verification');
  } catch (error) {
    logError('dev-sentry-test', error, { user: 'test' });
    throw error;
  }
}

export const triggerServerActionSentryError = testServerAction;
