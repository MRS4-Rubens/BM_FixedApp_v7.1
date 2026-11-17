import {
  GST_FILING_FREQUENCIES,
  NOTIFICATION_CATEGORIES,
  isOneOf,
  type GstFilingFrequency,
  type NotificationCategory,
} from '@/lib/db/domain-values';

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return isOneOf(NOTIFICATION_CATEGORIES, value);
}

export function isGstFilingFrequency(value: unknown): value is GstFilingFrequency {
  return isOneOf(GST_FILING_FREQUENCIES, value);
}
