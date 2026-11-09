import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import {
  runWithRequestId,
  currentRequestId,
  requestIdFromHeaders,
} from '@/lib/observability/request-context';
import { logError, logWarn } from '@/lib/actions/_shared/logger';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe('OPT-001: Request Context & ID Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestIdFromHeaders', () => {
    it('prefers a valid x-vercel-id', () => {
      const headers = new Headers({
        'x-vercel-id': 'iad1:iad1::abc123_xyz-89',
        'x-request-id': 'req-fallback-456',
      });
      expect(requestIdFromHeaders(headers)).toBe('iad1:iad1::abc123_xyz-89');
    });

    it('falls back to a valid x-request-id if x-vercel-id is missing', () => {
      const headers = new Headers({
        'x-request-id': 'req-fallback-456',
      });
      expect(requestIdFromHeaders(headers)).toBe('req-fallback-456');
    });

    it('falls back to a valid x-request-id if x-vercel-id is invalid', () => {
      const headers = new Headers({
        'x-vercel-id': 'invalid header with spaces',
        'x-request-id': 'valid-req-id_123',
      });
      expect(requestIdFromHeaders(headers)).toBe('valid-req-id_123');
    });

    it('rejects values with spaces, newlines, quotes or > 128 chars and generates a UUID', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Space
      expect(requestIdFromHeaders(new Headers({ 'x-vercel-id': 'bad value' }))).toMatch(uuidRegex);
      // Newline (header injection attempt via mock getter)
      const newlineHeaders = { get: (name: string) => (name === 'x-vercel-id' ? 'bad\nvalue' : null) };
      expect(requestIdFromHeaders(newlineHeaders)).toMatch(uuidRegex);
      // Quotes
      expect(requestIdFromHeaders(new Headers({ 'x-vercel-id': '"bad-value"' }))).toMatch(uuidRegex);
      expect(requestIdFromHeaders(new Headers({ 'x-request-id': "'bad-value'" }))).toMatch(uuidRegex);
      // Semicolon / other special characters
      expect(requestIdFromHeaders(new Headers({ 'x-request-id': 'bad;value' }))).toMatch(uuidRegex);
      // > 128 chars
      const longId = 'a'.repeat(129);
      expect(requestIdFromHeaders(new Headers({ 'x-vercel-id': longId }))).toMatch(uuidRegex);

      // Empty / missing
      expect(requestIdFromHeaders(new Headers())).toMatch(uuidRegex);
    });

    it('accepts valid 128 char IDs', () => {
      const valid128 = 'a'.repeat(128);
      expect(requestIdFromHeaders(new Headers({ 'x-vercel-id': valid128 }))).toBe(valid128);
    });
  });

  describe('currentRequestId & runWithRequestId', () => {
    it('returns undefined outside runWithRequestId and correct value inside', async () => {
      expect(currentRequestId()).toBeUndefined();

      await runWithRequestId('custom-request-id-42', async () => {
        expect(currentRequestId()).toBe('custom-request-id-42');
      });

      expect(currentRequestId()).toBeUndefined();
    });

    it('isolates context between concurrent async executions', async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      let task1Observed: string | undefined;
      let task2Observed: string | undefined;

      const p1 = runWithRequestId('task-1-id', async () => {
        await delay(20);
        task1Observed = currentRequestId();
      });

      const p2 = runWithRequestId('task-2-id', async () => {
        await delay(10);
        task2Observed = currentRequestId();
      });

      await Promise.all([p1, p2]);

      expect(task1Observed).toBe('task-1-id');
      expect(task2Observed).toBe('task-2-id');
      expect(currentRequestId()).toBeUndefined();
    });
  });

  describe('logError & logWarn integration with request context', () => {
    it('logError includes requestId in JSON output inside runWithRequestId and omits it outside', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Outside context
      logError('scope-outside', new Error('error outside'));
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const outsideLog = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
      expect(outsideLog.requestId).toBeUndefined();
      expect('requestId' in outsideLog).toBe(false);

      // Inside context
      await runWithRequestId('req-ctx-999', async () => {
        logError('scope-inside', new Error('error inside'));
      });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      const insideLog = JSON.parse(consoleErrorSpy.mock.calls[1][0] as string);
      expect(insideLog.requestId).toBe('req-ctx-999');

      consoleErrorSpy.mockRestore();
    });

    it('sets Sentry tag request_id inside a run and omits it outside', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Outside
      logError('scope-outside', new Error('sentry err outside'));
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { scope: 'scope-outside' },
        }),
      );

      // Inside with Error
      await runWithRequestId('sentry-tag-123', async () => {
        logError('scope-inside', new Error('sentry err inside'));
      });
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { scope: 'scope-inside', request_id: 'sentry-tag-123' },
        }),
      );

      // Inside with string error
      await runWithRequestId('sentry-tag-456', async () => {
        logError('scope-inside-str', 'string error inside');
      });
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'string error inside',
        expect.objectContaining({
          tags: { scope: 'scope-inside-str', request_id: 'sentry-tag-456' },
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    it('adds requestId to logWarn breadcrumb data when inside a run', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Outside
      logWarn('scope-warn-outside', 'warn outside');
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'warning',
        level: 'warning',
        message: 'scope-warn-outside: warn outside',
      });

      // Inside
      await runWithRequestId('warn-req-789', async () => {
        logWarn('scope-warn-inside', 'warn inside');
      });
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'warning',
        level: 'warning',
        message: 'scope-warn-inside: warn inside',
        data: { requestId: 'warn-req-789' },
      });

      consoleWarnSpy.mockRestore();
    });
  });
});
