-- API-010: legacy trial rows with NO end date were treated as a permanent trial. Give them the standard 14-day window
-- counted from account creation. Rows whose window has already passed become expired (intended: fail closed).
-- Idempotent: after the first run no row matches the WHERE clause.
UPDATE "businesses"
SET "trial_ends_at" = "created_at" + interval '14 days'
WHERE "trial_ends_at" IS NULL
  AND "subscription_status" NOT IN ('active', 'suspended')
  AND ("subscription_status" = 'trial' OR "subscription_plan" = 'trial');
