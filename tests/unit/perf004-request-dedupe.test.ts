import { describe, it, expect, vi, beforeEach } from 'vitest';
import { users, businesses } from '@/lib/db/schema';
import { createInitialFakeState, createFakeDb, type FakeState } from './helpers/perf004-fakes';

const scope = vi.hoisted(() => {
  let store = new Map<string, unknown>();
  let fnSeq = 0;
  return {
    reset: () => {
      store = new Map();
    },
    get store() {
      return store;
    },
    nextId: () => Symbol(`cached_fn_${++fnSeq}`),
  };
});

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

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => {
      const id = scope.nextId();
      return ((...args: unknown[]) => {
        const key = id.toString() + JSON.stringify(args);
        if (!scope.store.has(key)) {
          scope.store.set(key, fn(...args));
        }
        return scope.store.get(key);
      }) as T;
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
import { getCurrentAppUser, requireSession } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { isPlatformAdmin } from '@/lib/auth/admin';

describe('PERF-004: Request-scoped deduplication in render pass', () => {
  let state: FakeState;

  beforeEach(() => {
    scope.reset();
    state = createInitialFakeState();
    sharedState.setState(state);
    sharedState.getSessionMock.mockReset();
    sharedState.getSessionMock.mockImplementation(async () => ({
      data: state.sessionData,
    }));
  });

  it('layout + page in ONE render share one session, one users and one businesses query', async () => {
    // Layout simulation: concurrent user + admin check, then business lookup
    const [layoutUser, isAdmin] = await Promise.all([
      getCurrentAppUser(),
      isPlatformAdmin(),
    ]);
    const layoutBusiness = layoutUser?.business_id ? await getCurrentBusiness() : null;

    // Page simulation: calls getCurrentAppUser, getCurrentBusiness, requireSession
    const pageUser = await getCurrentAppUser();
    const pageBusiness = await getCurrentBusiness();
    const session = await requireSession();

    expect(layoutUser.id).toBe('user-1');
    expect(isAdmin).toBe(false);
    expect(layoutBusiness?.id).toBe('biz-1');
    expect(pageUser.id).toBe('user-1');
    expect(pageBusiness?.id).toBe('biz-1');
    expect(session.user.id).toBe('auth-1');

    // Memoized within one render pass: exactly 1 session, 1 users SELECT, 1 businesses SELECT
    expect(sharedState.getSessionMock).toHaveBeenCalledTimes(1);
    expect(state.selectCount.users).toBe(1);
    expect(state.selectCount.businesses).toBe(1);
  });

  it('new render after a mutation reads fresh (no stale user)', async () => {
    // Render 1: user has no business
    state.userRow!.business_id = null;
    const r1Business = await getCurrentBusiness();
    expect(r1Business).toBeNull();
    expect(state.selectCount.users).toBe(1);
    expect(state.selectCount.businesses).toBe(0);

    // Simulate Server Action mutation: link user to biz-1
    state.userRow!.business_id = 'biz-1';

    // Simulate new request/render pass
    scope.reset();

    // Render 2: reads fresh state
    const r2User = await getCurrentAppUser();
    const r2Business = await getCurrentBusiness();

    expect(r2User.business_id).toBe('biz-1');
    expect(r2Business?.id).toBe('biz-1');

    // Second render issued another query
    expect(state.selectCount.users).toBe(2);
    expect(state.selectCount.businesses).toBe(1);
    expect(sharedState.getSessionMock).toHaveBeenCalledTimes(2);
  });

  it('self-heal inside a render: later callers in the same render see the healed row', async () => {
    // Initial: user email missing, session has email
    state.userRow!.email = null;
    state.sessionData!.user.email = 'healed@example.com';

    const user1 = await getCurrentAppUser();
    expect(user1.email).toBe('healed@example.com');
    expect(state.updateCount.users).toBe(1);
    expect(state.selectCount.users).toBe(1);

    // Second call in the same render pass returns cached healed object without a second update or query
    const user2 = await getCurrentAppUser();
    expect(user2.email).toBe('healed@example.com');
    expect(user2).toBe(user1);
    expect(state.updateCount.users).toBe(1);
    expect(state.selectCount.users).toBe(1);
  });

  it('user with no business: getCurrentBusiness returns null without a businesses query', async () => {
    state.userRow!.business_id = null;

    const business = await getCurrentBusiness();

    expect(business).toBeNull();
    expect(state.selectCount.users).toBe(1);
    expect(state.selectCount.businesses).toBe(0);
  });
});
