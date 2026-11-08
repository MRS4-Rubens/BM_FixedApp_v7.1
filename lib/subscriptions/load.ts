import { businesses } from '@/lib/db/schema';

/** The business columns getPlanEntitlements / resolveBusinessPlan need. Spread into a select so no caller forgets one (e.g. trial_ends_at). */
export const PLAN_SOURCE_COLUMNS = {
  subscription_plan: businesses.subscription_plan,
  subscription_status: businesses.subscription_status,
  trial_ends_at: businesses.trial_ends_at,
  subscription_ends_at: businesses.subscription_ends_at,
} as const;

