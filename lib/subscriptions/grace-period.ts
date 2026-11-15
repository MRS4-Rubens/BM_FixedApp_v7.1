export const GRACE_HOURS = 48;

export function computeGraceEndsAt(
  currentEndsAt: Date | null,
  now: Date,
  hours: number = GRACE_HOURS
): Date {
  const base = currentEndsAt && currentEndsAt.getTime() > now.getTime() ? currentEndsAt : now;
  return new Date(base.getTime() + hours * 3_600_000);
}
