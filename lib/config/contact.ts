export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || 'support@billmatrix.in'

export const FEEDBACK_RECIPIENT_EMAIL =
  process.env.FEEDBACK_RECIPIENT_EMAIL?.trim() || SUPPORT_EMAIL
