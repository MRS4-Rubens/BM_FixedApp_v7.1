import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { ActionResult } from './types';
import { ActionError } from './errors';
import { logError } from './logger';
import { getCurrentAppUser } from '@/lib/auth/session';
import { users } from '@/lib/db/schema';
import { headers } from 'next/headers';
import { getClientIp, type RateLimiter } from '@/lib/rate-limit/upstash';
import {
  enforceRateLimit,
  type OutagePolicy,
  type RateLimitOutcome,
} from '@/lib/rate-limit/enforce';
import { defaultActionLimiter } from '@/lib/rate-limit/limiters';
import {
  type AppRole,
  evaluateRoleAccess,
  FORBIDDEN_ROLE_CODE,
  FORBIDDEN_ROLE_MESSAGE,
} from '@/lib/auth/rbac';

type AppUser = typeof users.$inferSelect;

export interface ExplicitRateLimit {
  readonly limiter: RateLimiter;
  readonly keyPrefix: string;
  /** REQUIRED: what to do when the rate-limit store is unreachable. */
  readonly outage: OutagePolicy;
}

const RATE_LIMITED_MESSAGE = (seconds: number): string =>
  `Too many requests. Please try again in ${seconds} seconds.`;
const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  'We are temporarily unable to process this request. Please try again in a moment.';

function throwIfBlocked(outcome: RateLimitOutcome): void {
  if (outcome.allowed) return;
  if (outcome.reason === 'limited') {
    throw new ActionError(RATE_LIMITED_MESSAGE(outcome.retryAfterSeconds), {
      code: 'RATE_LIMITED',
    });
  }
  throw new ActionError(RATE_LIMIT_UNAVAILABLE_MESSAGE, {
    code: 'SERVICE_UNAVAILABLE',
  });
}

const GENERIC_ERROR_MESSAGE =
  'Something went wrong on our end. Please try again, and contact support if the problem continues.';

async function runValidatedHandler<TSchema extends z.ZodTypeAny, TOutput, TContext>(
  schema: TSchema,
  rawInput: unknown,
  scopeName: string,
  resolveContext: () => Promise<TContext>,
  handler: (parsedData: z.infer<TSchema>, context: TContext) => Promise<TOutput>
): Promise<ActionResult<TOutput>> {
  const parseResult = schema.safeParse(rawInput);

  if (!parseResult.success) {
    const flattened = z.flattenError(parseResult.error);
    return {
      success: false,
      error: {
        message: 'Please check the highlighted fields and try again.',
        code: 'VALIDATION_ERROR',
        fieldErrors: flattened.fieldErrors,
      },
    };
  }

  try {
    const context = await resolveContext();
    const result = await handler(parseResult.data, context);
    return { success: true, data: result };
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof ActionError) {
      logError(scopeName, error, { code: error.code, expected: true });
      return {
        success: false,
        error: {
          message: error.message,
          code: error.code,
          fieldErrors: error.fieldErrors,
        },
      };
    }

    logError(scopeName, error, { expected: false });
    return {
      success: false,
      error: { message: GENERIC_ERROR_MESSAGE, code: 'INTERNAL_ERROR' },
    };
  }
}

export function createAction<TSchema extends z.ZodTypeAny, TOutput>(
  schema: TSchema,
  handler: (parsedData: z.infer<TSchema>, context: undefined) => Promise<TOutput>,
  scopeName: string,
  options?: { rateLimit?: ExplicitRateLimit }
) {
  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    return runValidatedHandler(
      schema,
      rawInput,
      scopeName,
      async () => {
        if (options?.rateLimit) {
          const ip = getClientIp(await headers());
          const outcome = await enforceRateLimit({
            limiter: options.rateLimit.limiter,
            identifier: `${options.rateLimit.keyPrefix}:${ip}`,
            policy: options.rateLimit.outage,
            scope: options.rateLimit.keyPrefix,
          });
          throwIfBlocked(outcome);
        }
        return undefined;
      },
      handler
    );
  };
}

export function createAuthenticatedAction<TSchema extends z.ZodTypeAny, TOutput>(
  schema: TSchema,
  handler: (parsedData: z.infer<TSchema>, context: { appUser: AppUser }) => Promise<TOutput>,
  scopeName: string,
  options?: {
    rateLimit?: ExplicitRateLimit | false;
    requirePlatformAdmin?: boolean;
    requireActiveSubscription?: boolean;
    /** AUTH-003: only these roles may run the action. Omitted = every role of the business. Checked BEFORE platform-admin, rate limit and handler. */
    roles?: readonly AppRole[];
  }
) {
  if (options?.roles !== undefined && options.roles.length === 0) {
    throw new Error(`createAuthenticatedAction("${scopeName}"): "roles" must not be an empty list.`);
  }

  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    return runValidatedHandler(
      schema,
      rawInput,
      scopeName,
      async () => {
        const appUser = await getCurrentAppUser();
        if (!appUser) {
          throw new ActionError(
            'We could not find your account details. Please try logging out and back in.',
            { code: 'NO_APP_USER' }
          );
        }

        if (options?.roles !== undefined) {
          const decision = evaluateRoleAccess(appUser.role, options.roles);
          if (!decision.allowed) {
            throw new ActionError(FORBIDDEN_ROLE_MESSAGE, { code: FORBIDDEN_ROLE_CODE });
          }
        }

        if (options?.requirePlatformAdmin) {
          const { requirePlatformAdmin } = await import('@/lib/auth/admin');
          await requirePlatformAdmin();
        }

        if (options?.requireActiveSubscription === true && appUser.business_id) {
          const { assertBusinessNotSuspended } = await import(
            '@/lib/actions/_shared/subscription-guard'
          );
          await assertBusinessNotSuspended(appUser.business_id);
        }

        const rateLimit = options?.rateLimit;
        if (rateLimit !== false) {
          const outcome = rateLimit
            ? await enforceRateLimit({
                limiter: rateLimit.limiter,
                identifier: `${rateLimit.keyPrefix}:${appUser.id}`,
                policy: rateLimit.outage,
                scope: rateLimit.keyPrefix,
              })
            : await enforceRateLimit({
                limiter: defaultActionLimiter,
                identifier: `default:${scopeName}:${appUser.id}`,
                policy: 'fail-open',
                scope: 'action-default',
              });
          throwIfBlocked(outcome);
        }

        return { appUser };
      },
      handler
    );
  };
}
