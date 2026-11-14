import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedPool {
  options: unknown;
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  on(event: string, listener: (...args: unknown[]) => void): RecordedPool;
  emit(event: string, ...args: unknown[]): boolean;
  listenerCount(event: string): number;
}

const {
  mockPoolInstances,
  mockLogError,
  mockGetDatabaseEnv,
  mockDrizzle,
} = vi.hoisted(() => {
  const instances: RecordedPool[] = [];
  const logErrorFn = vi.fn();
  const getDatabaseEnvFn = vi.fn(() => ({
    DATABASE_URL: 'postgresql://u:p@host/db',
  }));
  const drizzleFn = vi.fn((pool: unknown) => ({
    pool,
    isDrizzleInstance: true,
  }));

  return {
    mockPoolInstances: instances,
    mockLogError: logErrorFn,
    mockGetDatabaseEnv: getDatabaseEnvFn,
    mockDrizzle: drizzleFn,
  };
});

vi.mock('@neondatabase/serverless', () => {
  class FakePool implements RecordedPool {
    public options: unknown;
    public listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options?: unknown) {
      this.options = options;
      mockPoolInstances.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      const existing = this.listeners.get(event) ?? [];
      existing.push(listener);
      this.listeners.set(event, existing);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const list = this.listeners.get(event) ?? [];
      for (const listener of list) {
        listener(...args);
      }
      return list.length > 0;
    }

    listenerCount(event: string): number {
      return (this.listeners.get(event) ?? []).length;
    }
  }

  return {
    Pool: FakePool,
    neonConfig: {},
  };
});

vi.mock('drizzle-orm/neon-serverless', () => ({
  drizzle: mockDrizzle,
}));

vi.mock('@/lib/env', () => ({
  getDatabaseEnv: mockGetDatabaseEnv,
}));

vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: mockLogError,
}));

describe('DB-006: client.ts pool wiring unit tests (mocked driver)', () => {
  beforeEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, '__billMatrixDb');
    mockPoolInstances.length = 0;
    mockLogError.mockReset();
    mockGetDatabaseEnv.mockClear();
    mockDrizzle.mockClear();
  });

  it('1. importing the module does not construct a Pool and does not read env', async () => {
    await import('@/lib/db/client');
    expect(mockPoolInstances).toHaveLength(0);
    expect(mockGetDatabaseEnv).not.toHaveBeenCalled();
  });

  it('2. first getDb() constructs exactly ONE Pool with bounded options', async () => {
    const { getDb } = await import('@/lib/db/client');
    const db = getDb();
    expect(db).toBeDefined();
    expect(mockPoolInstances).toHaveLength(1);
    expect(mockPoolInstances[0]?.options).toStrictEqual({
      connectionString: 'postgresql://u:p@host/db',
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    expect(mockGetDatabaseEnv).toHaveBeenCalledTimes(1);
  });

  it('3. pool has exactly ONE error listener immediately after construction', async () => {
    const { getDb } = await import('@/lib/db/client');
    getDb();
    expect(mockPoolInstances).toHaveLength(1);
    expect(mockPoolInstances[0]?.listenerCount('error')).toBe(1);
  });

  it('4. emitting error on fake pool calls logError once with db-pool and idle-client', async () => {
    const { getDb } = await import('@/lib/db/client');
    getDb();
    const testError = new Error('simulated serverless idle connection termination');
    mockPoolInstances[0]?.emit('error', testError);

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('db-pool', testError, { source: 'idle-client' });
  });

  it('5. if logError throws, emitting on pool still does not throw', async () => {
    mockLogError.mockImplementationOnce(() => {
      throw new Error('logger or Sentry crashed');
    });

    const { getDb } = await import('@/lib/db/client');
    getDb();

    expect(() => {
      mockPoolInstances[0]?.emit('error', new Error('idle disconnect'));
    }).not.toThrow();

    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it('6. repeated getDb() calls return the same instance and construct ONE pool; resets on global delete', async () => {
    const { getDb } = await import('@/lib/db/client');
    const firstCall = getDb();
    const secondCall = getDb();

    expect(firstCall).toBe(secondCall);
    expect(mockPoolInstances).toHaveLength(1);

    // Simulate HMR / isolate reset
    Reflect.deleteProperty(globalThis, '__billMatrixDb');
    vi.resetModules();

    const { getDb: getDbAfterHmr } = await import('@/lib/db/client');
    const thirdCall = getDbAfterHmr();

    expect(thirdCall).toBeDefined();
    expect(mockPoolInstances).toHaveLength(2);
  });

  it('7. credentials hygiene: logError calls contain neither connection string nor credentials', async () => {
    const { getDb } = await import('@/lib/db/client');
    getDb();

    mockPoolInstances[0]?.emit('error', new Error('compute node restarting'));

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const callsString = JSON.stringify(mockLogError.mock.calls);
    expect(callsString).not.toContain('u:p@');
    expect(callsString).not.toContain('postgresql://');
  });
});
