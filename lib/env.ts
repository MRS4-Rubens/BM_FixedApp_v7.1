import { z } from 'zod';
import { normalizeS3Endpoint } from './storage/normalize-endpoint';

/* ------------------------------------------------------------------ */
/* Core types and error                                                 */
/* ------------------------------------------------------------------ */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  readonly group: string;
  readonly name: string;
  readonly message: string;
}

export function formatEnvIssues(issues: readonly EnvIssue[]): string {
  return issues.map((issue) => `  - [${issue.group}] ${issue.name}: ${issue.message}`).join('\n');
}

/** Thrown when a required environment group is missing or malformed. Never contains values. */
export class EnvConfigError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(`Invalid environment configuration:\n${formatEnvIssues(issues)}`);
    this.name = 'EnvConfigError';
    this.issues = issues;
  }
}

/** Duck-typed guard (robust to the class being bundled more than once). */
export function isEnvConfigError(error: unknown): error is EnvConfigError {
  return error instanceof Error && error.name === 'EnvConfigError' && 'issues' in error;
}

/* ------------------------------------------------------------------ */
/* Group machinery                                                      */
/* ------------------------------------------------------------------ */

type ParseOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly EnvIssue[] };

export interface EnvGroup<T> {
  readonly label: string;
  /** Pure validation of an explicit source. Never cached. */
  parse(source: EnvSource): ParseOutcome<T>;
  /** Lazily validates process.env once; caches success only; throws EnvConfigError. */
  get(): T;
}

function defineGroup<T>(label: string, parse: (source: EnvSource) => ParseOutcome<T>): EnvGroup<T> {
  let cached: { readonly value: T } | undefined;
  return {
    label,
    parse,
    get(): T {
      if (cached !== undefined) {
        return cached.value;
      }
      const outcome = parse(process.env);
      if (!outcome.ok) {
        throw new EnvConfigError(outcome.issues);
      }
      cached = { value: outcome.value };
      return outcome.value;
    },
  };
}

function fromSchema<S extends z.ZodType, T>(
  group: string,
  schema: S,
  finalize: (data: z.output<S>) => T,
): (source: EnvSource) => ParseOutcome<T> {
  return (source) => {
    const result = schema.safeParse(source);
    if (result.success) {
      return { ok: true, value: finalize(result.data) };
    }
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        group,
        name: String(issue.path[0] ?? 'env'),
        // Env values are strings or undefined, so a type error always means "missing".
        message: issue.code === 'invalid_type' ? 'is required' : issue.message,
      })),
    };
  };
}

/* ------------------------------------------------------------------ */
/* Shared validators (all messages are static: they never echo values)  */
/* ------------------------------------------------------------------ */

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const isHttpsUrl = (value: string): boolean => parseHttpUrl(value)?.protocol === 'https:';

function isBareOrigin(url: URL): boolean {
  return (
    url.pathname.replace(/\/+$/, '') === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

function isValidS3Endpoint(value: string): boolean {
  try {
    normalizeS3Endpoint(value);
    return true;
  } catch {
    return false;
  }
}

function stripWrappingQuotes(value: string): string {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  return value.length >= 2 && (first === '"' || first === "'") && first === last
    ? value.slice(1, -1).trim()
    : value;
}

const SENDER_PATTERN =
  /^(?:[^<>\r\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const LOCAL_HOSTNAME = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|.+\.local|.+\.localhost|.+\.internal)$/i;
const DEV_DEFAULT_APP_URL = 'http://localhost:3000';

const text = () => z.string().trim().min(1, 'must not be empty');
const secret = () => z.string().trim().min(32, 'must be at least 32 characters');

/**
 * SKIP_ENV_VALIDATION=1 is honoured for local/CI builds only. It is ignored on any hosted deployment:
 * Vercel production (VERCEL_ENV=production) and every Render service (Render always sets RENDER=true,
 * at build time and at runtime). LAUNCH-L2: without the Render rule a mistaken variable would switch off
 * the startup safety checks in production.
 */
export function isEnvValidationSkipped(source: EnvSource = process.env): boolean {
  if (source.SKIP_ENV_VALIDATION !== '1') return false;
  if (source.VERCEL_ENV === 'production') return false;
  if (source.RENDER === 'true') return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Group value types                                                    */
/* ------------------------------------------------------------------ */

export type AppEnv = Readonly<{ NEXT_PUBLIC_APP_URL: string }>;
export type DatabaseEnv = Readonly<{ DATABASE_URL: string }>;
export type AuthEnv = Readonly<{ NEON_AUTH_BASE_URL: string; NEON_AUTH_COOKIE_SECRET: string }>;
export type CronEnv = Readonly<{ CRON_SECRET: string }>;
export type AdminEnv = Readonly<{
  PLATFORM_ADMIN_EMAILS: readonly string[];
  PLATFORM_ADMIN_USER_IDS: readonly string[];
}>;
export type StorageEnv = Readonly<{
  IDRIVE_E2_ENDPOINT: string;
  IDRIVE_E2_REGION: string;
  IDRIVE_E2_BUCKET_NAME: string;
  IDRIVE_E2_ACCESS_KEY: string;
  IDRIVE_E2_SECRET_KEY: string;
}>;
export type PdfEnv = Readonly<{ HTML_TO_PDF_API_KEY: string }>;
export type EmailEnv = Readonly<{ BREVO_API_KEY: string; EMAIL_FROM: string }>;
export type RateLimitEnv = Readonly<{
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
}>;

/* ------------------------------------------------------------------ */
/* CORE groups                                                          */
/* ------------------------------------------------------------------ */

/**
 * Vercel Preview deployments each get their own generated address, so NEXT_PUBLIC_APP_URL cannot be set to one
 * fixed value for the Preview environment. When it is unset on a Preview deployment, use the deployment's own
 * address (VERCEL_URL, a bare host injected by Vercel). Production never falls back: it must set the variable
 * explicitly (ARCH-002 fail-closed), and an explicit value always wins.
 */
function vercelPreviewOrigin(source: EnvSource): string | null {
  if (source.VERCEL_ENV !== 'preview') return null;
  const host = source.VERCEL_URL?.trim() ?? '';
  if (host === '' || host.includes('/') || host.includes('://')) return null;
  return `https://${host}`;
}

function parseAppEnv(source: EnvSource): ParseOutcome<AppEnv> {
  const name = 'NEXT_PUBLIC_APP_URL';
  const fail = (message: string): ParseOutcome<AppEnv> => ({
    ok: false,
    issues: [{ group: 'app', name, message }],
  });

  const isProduction = source.NODE_ENV === 'production';
  const strict = isProduction && !isEnvValidationSkipped(source);
  const raw = source[name]?.trim() ?? '';
  const candidate = raw !== '' ? raw : (vercelPreviewOrigin(source) ?? (isProduction ? '' : DEV_DEFAULT_APP_URL));

  if (candidate === '') {
    return fail('is required in production (e.g. https://app.example.com)');
  }
  const url = parseHttpUrl(candidate);
  if (url === null) {
    return fail('must be a valid http(s) URL');
  }
  if (!isBareOrigin(url)) {
    return fail('must be an origin only (no path, query, credentials or fragment)');
  }
  if (strict) {
    if (url.protocol !== 'https:') {
      return fail('must use https:// in production');
    }
    if (LOCAL_HOSTNAME.test(url.hostname)) {
      return fail('must be a publicly reachable host in production (not localhost, .local or .internal)');
    }
  }
  return { ok: true, value: { NEXT_PUBLIC_APP_URL: url.origin } };
}

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

function parseAdminEnv(source: EnvSource): ParseOutcome<AdminEnv> {
  const emails = splitList(source.PLATFORM_ADMIN_EMAILS).map((entry) => entry.toLowerCase());
  const userIds = splitList(source.PLATFORM_ADMIN_USER_IDS);
  const issues: EnvIssue[] = [];
  if (!emails.every((email) => EMAIL_PATTERN.test(email))) {
    issues.push({ group: 'admin', name: 'PLATFORM_ADMIN_EMAILS', message: 'contains an invalid e-mail address' });
  }
  if (!userIds.every((id) => USER_ID_PATTERN.test(id))) {
    issues.push({ group: 'admin', name: 'PLATFORM_ADMIN_USER_IDS', message: 'contains an invalid user id' });
  }
  if (issues.length === 0 && emails.length === 0 && userIds.length === 0) {
    issues.push({
      group: 'admin',
      name: 'PLATFORM_ADMIN_USER_IDS',
      message: 'configure at least one administrator: PLATFORM_ADMIN_USER_IDS (preferred) or PLATFORM_ADMIN_EMAILS',
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { PLATFORM_ADMIN_EMAILS: emails, PLATFORM_ADMIN_USER_IDS: userIds } };
}

export const appEnv: EnvGroup<AppEnv> = defineGroup('app', parseAppEnv);

const databaseEnv: EnvGroup<DatabaseEnv> = defineGroup(
  'database',
  fromSchema(
    'database',
    z.object({
      DATABASE_URL: z
        .string()
        .trim()
        .refine((value) => /^postgres(?:ql)?:\/\//i.test(value), 'must be a postgres:// or postgresql:// connection string'),
    }),
    (data): DatabaseEnv => data,
  ),
);

const authEnv: EnvGroup<AuthEnv> = defineGroup(
  'auth',
  fromSchema(
    'auth',
    z.object({
      NEON_AUTH_BASE_URL: z.string().trim().refine(isHttpsUrl, 'must be an https:// URL'),
      NEON_AUTH_COOKIE_SECRET: secret(),
    }),
    (data): AuthEnv => data,
  ),
);

const cronEnv: EnvGroup<CronEnv> = defineGroup(
  'cron',
  fromSchema('cron', z.object({ CRON_SECRET: secret() }), (data): CronEnv => data),
);

export const adminEnv: EnvGroup<AdminEnv> = defineGroup('admin', parseAdminEnv);

/**
 * LAUNCH-L2: the support / feedback inbox is shown on legal pages, checkout and settings. In production it must be
 * set explicitly (no silent placeholder); outside production the placeholder in lib/config/contact.ts is used.
 */
export type ContactEnv = Readonly<{ NEXT_PUBLIC_SUPPORT_EMAIL?: string; FEEDBACK_RECIPIENT_EMAIL?: string }>;

function parseContactEnv(source: EnvSource): ParseOutcome<ContactEnv> {
  const strict = source.NODE_ENV === 'production' && !isEnvValidationSkipped(source);
  const support = source.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? '';
  const feedback = source.FEEDBACK_RECIPIENT_EMAIL?.trim() ?? '';
  const issues: EnvIssue[] = [];
  if (support === '') {
    if (strict) issues.push({ group: 'contact', name: 'NEXT_PUBLIC_SUPPORT_EMAIL', message: 'is required in production' });
  } else if (!EMAIL_PATTERN.test(support)) {
    issues.push({ group: 'contact', name: 'NEXT_PUBLIC_SUPPORT_EMAIL', message: 'must be a single e-mail address' });
  }
  if (feedback !== '' && !EMAIL_PATTERN.test(feedback)) {
    issues.push({ group: 'contact', name: 'FEEDBACK_RECIPIENT_EMAIL', message: 'must be a single e-mail address' });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      ...(support !== '' ? { NEXT_PUBLIC_SUPPORT_EMAIL: support } : {}),
      ...(feedback !== '' ? { FEEDBACK_RECIPIENT_EMAIL: feedback } : {}),
    },
  };
}

const contactEnv: EnvGroup<ContactEnv> = defineGroup('contact', parseContactEnv);

/* ------------------------------------------------------------------ */
/* FEATURE groups (lazy; reported at boot, never thrown at boot)        */
/* ------------------------------------------------------------------ */

const storageEnv: EnvGroup<StorageEnv> = defineGroup(
  'storage',
  fromSchema(
    'storage',
    z.object({
      IDRIVE_E2_ENDPOINT: z
        .string()
        .trim()
        .refine(
          isValidS3Endpoint,
          'must be a bare host such as s3.<region>.idrivee2.com (https:// prefix and trailing slash are accepted)',
        ),
      IDRIVE_E2_REGION: text(),
      IDRIVE_E2_BUCKET_NAME: text(),
      IDRIVE_E2_ACCESS_KEY: text(),
      IDRIVE_E2_SECRET_KEY: text(),
    }),
    (data): StorageEnv => ({ ...data, IDRIVE_E2_ENDPOINT: normalizeS3Endpoint(data.IDRIVE_E2_ENDPOINT) }),
  ),
);

const pdfEnv: EnvGroup<PdfEnv> = defineGroup(
  'pdf',
  fromSchema('pdf', z.object({ HTML_TO_PDF_API_KEY: text() }), (data): PdfEnv => data),
);

const emailEnv: EnvGroup<EmailEnv> = defineGroup(
  'email',
  fromSchema(
    'email',
    z.object({
      BREVO_API_KEY: text(),
      EMAIL_FROM: z
        .string()
        .trim()
        .refine(
          (value) => SENDER_PATTERN.test(stripWrappingQuotes(value)),
          'must be an e-mail address or "Display Name <email@domain>"',
        ),
    }),
    (data): EmailEnv => ({ ...data, EMAIL_FROM: stripWrappingQuotes(data.EMAIL_FROM) }),
  ),
);

/**
 * Plain http:// is accepted ONLY for a loopback Redis REST endpoint (the serverless-redis-http container used by the
 * CI browser tests) and ONLY when validation is skipped, which never happens on Render or Vercel production.
 */
const isLocalHttpUrl = (value: string): boolean => {
  const url = parseHttpUrl(value);
  return url !== null && url.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1)$/i.test(url.hostname);
};

function rateLimitSchema(allowLocalHttp: boolean) {
  return z.object({
    UPSTASH_REDIS_REST_URL: z
      .string()
      .trim()
      .refine((value) => isHttpsUrl(value) || (allowLocalHttp && isLocalHttpUrl(value)), 'must be an https:// URL'),
    UPSTASH_REDIS_REST_TOKEN: text(),
  });
}

function parseRateLimitEnv(source: EnvSource): ParseOutcome<RateLimitEnv> {
  return fromSchema('rateLimit', rateLimitSchema(isEnvValidationSkipped(source)), (data): RateLimitEnv => data)(source);
}

const rateLimitEnv: EnvGroup<RateLimitEnv> = defineGroup('rateLimit', parseRateLimitEnv);

/* ------------------------------------------------------------------ */
/* Typed lazy getters (the public API for the rest of the app)          */
/* ------------------------------------------------------------------ */

export function getAppEnv(): AppEnv { return appEnv.get(); }
export function getDatabaseEnv(): DatabaseEnv { return databaseEnv.get(); }
export function getAuthEnv(): AuthEnv { return authEnv.get(); }
export function getCronEnv(): CronEnv { return cronEnv.get(); }
export function getAdminEnv(): AdminEnv { return adminEnv.get(); }
export function getStorageEnv(): StorageEnv { return storageEnv.get(); }
export function getPdfEnv(): PdfEnv { return pdfEnv.get(); }
export function getEmailEnv(): EmailEnv { return emailEnv.get(); }
export function getRateLimitEnv(): RateLimitEnv { return rateLimitEnv.get(); }

/* ------------------------------------------------------------------ */
/* Boot-time checks                                                     */
/* ------------------------------------------------------------------ */

const CORE_GROUPS: readonly EnvGroup<unknown>[] = [appEnv, databaseEnv, authEnv, cronEnv, adminEnv, contactEnv];
const FEATURE_GROUPS: readonly EnvGroup<unknown>[] = [storageEnv, pdfEnv, emailEnv, rateLimitEnv];

function collectIssues(groups: readonly EnvGroup<unknown>[], source: EnvSource): readonly EnvIssue[] {
  return groups.flatMap((group) => {
    const outcome = group.parse(source);
    return outcome.ok ? [] : outcome.issues;
  });
}

export function checkCoreEnv(source: EnvSource = process.env): readonly EnvIssue[] {
  return collectIssues(CORE_GROUPS, source);
}

export function checkFeatureEnv(source: EnvSource = process.env): readonly EnvIssue[] {
  return collectIssues(FEATURE_GROUPS, source);
}

/** Throws one EnvConfigError listing EVERY core problem (names and reasons only). */
export function assertBootEnv(source: EnvSource = process.env): void {
  const issues = checkCoreEnv(source);
  if (issues.length > 0) {
    throw new EnvConfigError(issues);
  }
}
