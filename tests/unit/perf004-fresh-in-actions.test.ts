import { describe, it, expect, vi, beforeEach } from 'vitest';
import { users, businesses } from '@/lib/db/schema';
import { createInitialFakeState, createFakeDb, type FakeState } from './helpers/perf004-fakes';

// IMPORTANT: Do NOT mock 'react' cache here.
// In Node.js / Vitest (and in Next.js Server Actions and Route Handlers), React's cache() is
// a pass-through function, ensuring server actions and handlers always read fresh data.

const sharedState = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  let state: FakeState | null = null;
  return {
    getSessionMock,
    getState: () => state!,
    setState: (s: FakeState) => {
      state = s;
    },
  };
});

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: () => sharedState.getSessionMock(),
  },
}));

vi.mock('@/lib/env', () => ({
  getAdminEnv: () => ({
    PLATFORM_ADMIN_EMAILS: [],
    PLATFORM_ADMIN_USER_IDS: [],
  }),
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: (cols?: unknown) => createFakeDb(sharedState.getState(), users, businesses).select(cols),
    update: (table: unknown) => createFakeDb(sharedState.getState(), users, businesses).update(table),
  },
}));

// Import subject-under-test modules after mocks are installed
import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';

describe('PERF-004: Actions and Route Handlers always read fresh (no React cache render pass)', () => {
  let state: FakeState;

  beforeEach(() => {
    state = createInitialFakeState();
    sharedState.setState(state);
    sharedState.getSessionMock.mockReset();
    sharedState.getSessionMock.mockImplementation(async () => ({
      data: state.sessionData,
    }));
  });

  it('action context: a mutation followed by a re-read returns the new value', async () => {
    // Start with user having no business
    state.userRow!.business_id = null;

    const userBefore = await getCurrentAppUser();
    expect(userBefore.business_id).toBeNull();
    const sessionCallCount1 = sharedState.getSessionMock.mock.calls.length;

    // Simulate mutation inside an action: DB row updated
    state.userRow!.business_id = 'biz-1';

    // Immediate re-read inside the same action execution context
    const userAfter = await getCurrentAppUser();
    expect(userAfter.business_id).toBe('biz-1');

    // And business lookup succeeds immediately
    const business = await getCurrentBusiness();
    expect(business?.id).toBe('biz-1');

    // In actions/handlers (where React cache does not memoize across function calls),
    // each getCurrentAppUser invokes getRequestSession fresh
    expect(sharedState.getSessionMock.mock.calls.length).toBeGreaterThan(sessionCallCount1);
  });

  it('role change in the same action is visible on re-read', async () => {
    state.userRow!.role = 'owner';

    const userInitial = await getCurrentAppUser();
    expect(userInitial.role).toBe('owner');

    // Simulate role mutation
    state.userRow!.role = 'accountant';

    // Immediate re-read inside the same action
    const userUpdated = await getCurrentAppUser();
    expect(userUpdated.role).toBe('accountant');
  });
});

