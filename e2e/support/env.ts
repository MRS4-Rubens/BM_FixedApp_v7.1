import { z } from 'zod';

export class E2eSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eSafetyError';
  }
}

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((val): boolean => {
    if (typeof val === 'boolean') return val;
    return val === 'true' || val === '1';
  });

export const e2eEnvSchema = z.object({
  E2E_BASE_URL: z.string().url('E2E_BASE_URL must be a valid URL'),
  E2E_CONFIRM_STAGING: z.string(),
  E2E_FORBIDDEN_HOSTS: z.string().min(1, 'E2E_FORBIDDEN_HOSTS must not be empty'),
  E2E_DATABASE_URL: z.string().min(1, 'E2E_DATABASE_URL must not be empty'),
  E2E_DB_HOST_ALLOWLIST: z.string().min(1, 'E2E_DB_HOST_ALLOWLIST must not be empty'),
  E2E_FORBIDDEN_DB_HOSTS: z.string().min(1, 'E2E_FORBIDDEN_DB_HOSTS must not be empty'),
  // 'direct_db' is accepted as an alias of 'db' (the name used in the workflow and setup docs).
  E2E_VERIFY_MODE: z
    .enum(['db', 'mailbox', 'direct_db'])
    .default('db')
    .transform((mode): 'db' | 'mailbox' => (mode === 'direct_db' ? 'db' : mode)),
  E2E_EXPECT_VERIFICATION_REQUIRED: booleanFromString.default(true),
  E2E_ADMIN_EMAIL: z.string().email('E2E_ADMIN_EMAIL must be a valid email'),
  E2E_ADMIN_PASSWORD: z.string().min(8, 'E2E_ADMIN_PASSWORD must be at least 8 characters'),
  E2E_VERCEL_BYPASS_SECRET: z.string().optional(),
  E2E_UPSTASH_REST_URL: z.string().optional(),
  E2E_UPSTASH_REST_TOKEN: z.string().optional(),
  E2E_UPSTASH_ALLOW_FLUSH: booleanFromString.default(false),
  E2E_UPSTASH_HOST_ALLOWLIST: z.string().optional(),
  E2E_MAILOSAUR_API_KEY: z.string().optional(),
  MAILOSAUR_API_KEY: z.string().optional(),
  E2E_MAILOSAUR_SERVER_ID: z.string().optional(),
  MAILOSAUR_SERVER_ID: z.string().optional(),
  E2E_UPDATE_A11Y_BASELINE: booleanFromString.default(false),
  E2E_STAGING_DATABASE_URL_UNPOOLED: z.string().optional(),
});

export type E2eEnv = z.infer<typeof e2eEnvSchema>;

function extractHostname(urlString: string, label: string): string {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.toLowerCase();
  } catch {
    throw new E2eSafetyError(`Malformed URL provided for ${label}.`);
  }
}

export function parseCsv(csv: string): string[] {
  return csv
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function assertSafeTarget(env: E2eEnv): void {
  if (env.E2E_CONFIRM_STAGING !== 'yes-this-is-not-production') {
    throw new E2eSafetyError('Refusing to run: E2E_CONFIRM_STAGING is not set to the confirmation phrase.');
  }

  const host = extractHostname(env.E2E_BASE_URL, 'E2E_BASE_URL');
  const forbiddenHosts = parseCsv(env.E2E_FORBIDDEN_HOSTS);
  if (forbiddenHosts.includes(host)) {
    throw new E2eSafetyError(`Refusing to run against forbidden (production) host: ${host}`);
  }

  const dbHost = extractHostname(env.E2E_DATABASE_URL, 'E2E_DATABASE_URL');
  const forbiddenDbHosts = parseCsv(env.E2E_FORBIDDEN_DB_HOSTS);
  const allowlistDbHosts = parseCsv(env.E2E_DB_HOST_ALLOWLIST);

  if (forbiddenDbHosts.includes(dbHost) || !allowlistDbHosts.includes(dbHost)) {
    throw new E2eSafetyError('Refusing to run: database host is forbidden or not in E2E_DB_HOST_ALLOWLIST.');
  }

  if (env.E2E_STAGING_DATABASE_URL_UNPOOLED) {
    const unpooledDbHost = extractHostname(
      env.E2E_STAGING_DATABASE_URL_UNPOOLED,
      'E2E_STAGING_DATABASE_URL_UNPOOLED',
    );
    if (forbiddenDbHosts.includes(unpooledDbHost) || !allowlistDbHosts.includes(unpooledDbHost)) {
      throw new E2eSafetyError(
        'Refusing to run: unpooled database host is forbidden or not in E2E_DB_HOST_ALLOWLIST.',
      );
    }
  }

  if (env.E2E_UPSTASH_ALLOW_FLUSH && env.E2E_UPSTASH_REST_URL) {
    const upstashHost = extractHostname(env.E2E_UPSTASH_REST_URL, 'E2E_UPSTASH_REST_URL');
    if (env.E2E_UPSTASH_HOST_ALLOWLIST) {
      const allowedUpstash = parseCsv(env.E2E_UPSTASH_HOST_ALLOWLIST);
      if (!allowedUpstash.includes(upstashHost)) {
        throw new E2eSafetyError(
          'Refusing to run: Upstash host is not in E2E_UPSTASH_HOST_ALLOWLIST while flush is enabled.',
        );
      }
    }
  }
}

export function loadE2eEnv(raw: Record<string, unknown> = process.env): E2eEnv {
  const result = e2eEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new E2eSafetyError(`Invalid E2E environment configuration: ${issues}`);
  }
  return result.data;
}

