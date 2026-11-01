import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  DB_POOL_CONNECTION_TIMEOUT_MS,
  DB_POOL_ERROR_SCOPE,
  DB_POOL_IDLE_TIMEOUT_MS,
  DB_POOL_MAX_CONNECTIONS,
  attachPoolErrorHandler,
  buildPoolOptions,
} from '@/lib/db/pool-config';

describe('DB-006: Connection pool configuration (pure unit tests)', () => {
  it('defines constants matching audited values', () => {
    expect(DB_POOL_MAX_CONNECTIONS).toBe(5);
    expect(DB_POOL_IDLE_TIMEOUT_MS).toBe(10_000);
    expect(DB_POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(DB_POOL_ERROR_SCOPE).toBe('db-pool');
  });

  it('buildPoolOptions produces exact options dictionary', () => {
    const connectionString = 'postgresql://u:p@h/d';
    const options = buildPoolOptions(connectionString);
    expect(options).toStrictEqual({
      connectionString: 'postgresql://u:p@h/d',
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it('documents unhandled error crash failure mode: plain EventEmitter throws on error event with no listener', () => {
    const emitter = new EventEmitter();
    const boomError = new Error('boom');

    expect(() => {
      emitter.emit('error', boomError);
    }).toThrow('boom');
  });

  it('attaches non-throwing error handler that reports to reporter exactly once with correct payload', () => {
    const emitter = new EventEmitter();
    const reporter = vi.fn();

    attachPoolErrorHandler(emitter, reporter);

    const testError = new Error('simulated idle client drop');
    expect(() => {
      emitter.emit('error', testError);
    }).not.toThrow();

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith('db-pool', testError, { source: 'idle-client' });
  });

  it('swallows errors thrown by the reporter without crashing the process', () => {
    const emitter = new EventEmitter();
    const throwingReporter = vi.fn(() => {
      throw new Error('Sentry or logger down');
    });

    attachPoolErrorHandler(emitter, throwingReporter);

    expect(() => {
      emitter.emit('error', new Error('idle disconnect'));
    }).not.toThrow();

    expect(throwingReporter).toHaveBeenCalledTimes(1);
  });

  it('ignores extra arguments and prevents credentials leak from second client argument', () => {
    const emitter = new EventEmitter();
    const reporter = vi.fn();

    attachPoolErrorHandler(emitter, reporter);

    const sensitiveClientObject = {
      user: 'admin',
      password: 'secret-client-object',
      host: 'neon.tech',
    };

    expect(() => {
      emitter.emit('error', new Error('socket reset'), sensitiveClientObject);
    }).not.toThrow();

    expect(reporter).toHaveBeenCalledTimes(1);
    const callsString = JSON.stringify(reporter.mock.calls);
    expect(callsString).not.toContain('secret-client-object');
    expect(callsString).not.toContain('admin');
  });

  it('does not throw when emitting a non-Error value (e.g. a string)', () => {
    const emitter = new EventEmitter();
    const reporter = vi.fn();

    attachPoolErrorHandler(emitter, reporter);

    expect(() => {
      emitter.emit('error', 'plain string error');
    }).not.toThrow();

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith('db-pool', 'plain string error', { source: 'idle-client' });
  });
});

