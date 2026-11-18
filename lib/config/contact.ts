/**
 * Support contact shown across the app. LAUNCH-L2: production must set NEXT_PUBLIC_SUPPORT_EMAIL (the boot check
 * refuses to start without it); the fallback is a placeholder for local development only.
 */
export const DEV_SUPPORT_EMAIL = 'support@example.invalid'

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || DEV_SUPPORT_EMAIL

export const FEEDBACK_RECIPIENT_EMAIL =
  process.env.FEEDBACK_RECIPIENT_EMAIL?.trim() || SUPPORT_EMAIL
