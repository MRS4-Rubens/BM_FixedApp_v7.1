import { describe, expect, it, vi, beforeEach } from 'vitest';

const afterMock = vi.fn();
vi.mock('next/server', () => ({
  after: (cb: () => void | Promise<void>) => afterMock(cb),
}));

const logErrorMock = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const archiveDocumentMock = vi.fn();
vi.mock('@/lib/storage/archival-core', () => ({
  archiveDocument: (...args: unknown[]) => archiveDocumentMock(...args),
}));

import { scheduleArchival } from '@/lib/storage/schedule-archival';

describe('scheduleArchival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls after exactly once and never throws', () => {
    expect(() => scheduleArchival('invoice', 'inv-123')).not.toThrow();
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(typeof afterMock.mock.calls[0][0]).toBe('function');
  });

  it('callback executes archiveDocument and logs error on archival failure', async () => {
    archiveDocumentMock.mockResolvedValueOnce({
      success: false,
      skipped: false,
      error: 'Storage quota exceeded',
    });

    scheduleArchival('credit_note', 'cn-456');
    const scheduledCallback = afterMock.mock.calls[0][0] as () => Promise<void>;

    await scheduledCallback();

    expect(archiveDocumentMock).toHaveBeenCalledWith('credit_note', 'cn-456');
    expect(logErrorMock).toHaveBeenCalledWith(
      'archival',
      expect.objectContaining({ message: 'Storage quota exceeded' }),
      { kind: 'credit_note', documentId: 'cn-456' },
    );
  });

  it('callback swallows rejections without uncaught promise rejection', async () => {
    archiveDocumentMock.mockRejectedValueOnce(new Error('Unexpected network crash'));

    scheduleArchival('invoice', 'inv-789');
    const scheduledCallback = afterMock.mock.calls[0][0] as () => Promise<void>;

    await expect(scheduledCallback()).resolves.toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledWith(
      'archival',
      expect.objectContaining({ message: 'Unexpected network crash' }),
      { kind: 'invoice', documentId: 'inv-789' },
    );
  });

  it('catches and logs if after itself throws', () => {
    afterMock.mockImplementationOnce(() => {
      throw new Error('after() called outside of request context');
    });

    expect(() => scheduleArchival('invoice', 'inv-000')).not.toThrow();
    expect(logErrorMock).toHaveBeenCalledWith(
      'archival-schedule',
      expect.objectContaining({ message: 'after() called outside of request context' }),
      { kind: 'invoice', documentId: 'inv-000' },
    );
  });
});

