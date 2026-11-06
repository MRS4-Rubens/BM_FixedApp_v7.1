import { AsyncLocalStorage } from 'node:async_hooks';

export interface HarnessUser {
  readonly id: string;
  readonly email: string;
  readonly businessId: string | null;
  readonly role?: 'owner' | 'staff';
}

export const harnessState: { db: unknown } = {
  db: undefined,
};

export const loggedErrors: unknown[] = [];

export function resetLoggedErrors(): void {
  loggedErrors.length = 0;
}

const userStorage = new AsyncLocalStorage<HarnessUser>();

export function runAs<T>(user: HarnessUser, fn: () => Promise<T> | T): Promise<T> {
  return userStorage.run(user, () => Promise.resolve(fn()));
}

export function currentHarnessUser(): HarnessUser {
  const user = userStorage.getStore();
  if (!user) {
    throw new Error('currentHarnessUser() called outside runAs() context');
  }
  return user;
}

export function tryCurrentHarnessUser(): HarnessUser | null {
  return userStorage.getStore() ?? null;
}

export function dbClientModule(): { get db(): unknown; getDb: () => unknown } {
  return {
    get db() {
      return harnessState.db;
    },
    getDb: () => harnessState.db,
  };
}

export function sessionModule(): {
  getCurrentAppUser: () => Promise<{
    id: string;
    business_id: string | null;
    role: 'owner' | 'staff';
    email: string;
  }>;
} {
  return {
    getCurrentAppUser: async () => {
      const u = currentHarnessUser();
      return {
        id: u.id,
        business_id: u.businessId,
        role: u.role ?? 'owner',
        email: u.email,
      };
    },
  };
}

export function authServerModule(): {
  auth: {
    getSession: () => Promise<{
      data: {
        user: { id: string; email: string; emailVerified: boolean };
        session: { id: string };
      } | null;
    }>;
  };
} {
  return {
    auth: {
      getSession: async () => {
        const u = tryCurrentHarnessUser();
        if (!u) return { data: null };
        return {
          data: {
            user: {
              id: u.id,
              email: u.email,
              emailVerified: true,
            },
            session: {
              id: 'mock-session-id',
            },
          },
        };
      },
    },
  };
}

function describeLoggedError(scope: string, error: unknown): string {
  if (!(error instanceof Error)) return `${scope}: ${String(error)}`;
  const cause: unknown = error.cause;
  const pgCode =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? ` [pg ${cause.code}]`
      : '';
  const causeMessage = cause instanceof Error ? ` <- ${cause.message}` : '';
  return `${scope}: ${error.name}: ${error.message}${causeMessage}${pgCode}`;
}

export function loggerModule(): {
  logError: (scope: string, error: unknown, meta?: Record<string, unknown>) => void;
} {
  return {
    logError: (scope: string, error: unknown, meta?: Record<string, unknown>) => {
      loggedErrors.push({ scope, error, meta });
      // Unexpected errors are otherwise invisible (actions return a generic INTERNAL_ERROR). Surface the real
      // cause so a red CI run is diagnosable; expected ActionErrors stay silent.
      if (meta?.expected !== true) {
        console.error(`[realdb logError] ${describeLoggedError(scope, error)}`);
      }
    },
  };
}

export function rateLimitModule(): {
  sensitiveActionLimiter: Record<string, unknown>;
  checkRateLimit: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  enforceRateLimit: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  getClientIp: () => string;
} {
  return {
    sensitiveActionLimiter: {},
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    enforceRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    getClientIp: () => '127.0.0.1',
  };
}

export function storageModule(): {
  uploadFileToStorage: () => Promise<void>;
  getSignedDownloadUrl: () => Promise<string>;
} {
  return {
    uploadFileToStorage: async () => undefined,
    getSignedDownloadUrl: async () => 'https://mock-storage.test/download',
  };
}

export function emailModule(): {
  getResend: () => { emails: { send: () => Promise<{ id: string }> } };
} {
  return {
    getResend: () => ({
      emails: {
        send: async () => ({ id: 'mock-email-id' }),
      },
    }),
  };
}

export function envModule(): {
  getAppEnv: () => { NEXT_PUBLIC_APP_URL: string };
  getEmailEnv: () => { RESEND_FROM_EMAIL: string };
  getAdminEnv: () => { PLATFORM_ADMIN_EMAILS: string[]; PLATFORM_ADMIN_USER_IDS: string[] };
} {
  return {
    getAppEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://test.app' }),
    getEmailEnv: () => ({ RESEND_FROM_EMAIL: 'noreply@test.app' }),
    getAdminEnv: () => ({
      PLATFORM_ADMIN_EMAILS: ['admin@test.dev'],
      PLATFORM_ADMIN_USER_IDS: ['a0000000-0000-4000-8000-000000000099'],
    }),
  };
}

