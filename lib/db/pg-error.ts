export interface PgErrorInfo {
  code: string | null;
  constraint: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Unwraps driver/ORM wrappers (e.g. Drizzle's `cause`) up to 5 levels to find a Postgres error code/constraint. */
export function getPgError(error: unknown): PgErrorInfo {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!isRecord(current)) {
      break;
    }
    const code = typeof current.code === 'string' ? current.code : null;
    const constraint = typeof current.constraint === 'string' ? current.constraint : null;
    if (code !== null) {
      return { code, constraint };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return { code: null, constraint: null };
}

