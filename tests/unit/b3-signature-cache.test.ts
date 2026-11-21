import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileBuffer } = vi.hoisted(() => ({ getFileBuffer: vi.fn() }));
vi.mock('@/lib/storage/idrive', () => ({ getFileBuffer, deleteFileFromStorage: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/actions/_shared/logger', () => ({ logError: vi.fn() }));

import { clearSignatureCacheForTests, loadSignatureDataUri } from '@/lib/storage/signature';

// B3: New Invoice (and invoice views, settings, PDFs) downloaded the signature from IDrive e2 on every visit.
describe('B3 signature data URI cache', () => {
  beforeEach(() => {
    clearSignatureCacheForTests();
    getFileBuffer.mockReset();
  });

  it('downloads a signature once and serves repeat visits from memory', async () => {
    getFileBuffer.mockResolvedValue(Buffer.from('png-bytes'));
    const key = 'signatures/biz-1/abc.png';
    const first = await loadSignatureDataUri(key);
    const second = await loadSignatureDataUri(key);
    expect(first).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
    expect(second).toBe(first);
    expect(getFileBuffer).toHaveBeenCalledTimes(1);
  });

  it('a new upload (new random key) is fetched fresh', async () => {
    getFileBuffer.mockResolvedValueOnce(Buffer.from('old')).mockResolvedValueOnce(Buffer.from('new'));
    await loadSignatureDataUri('signatures/biz-1/old.png');
    const fresh = await loadSignatureDataUri('signatures/biz-1/new.png');
    expect(fresh).toContain(Buffer.from('new').toString('base64'));
    expect(getFileBuffer).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures (the next visit retries)', async () => {
    getFileBuffer.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(Buffer.from('ok'));
    const key = 'signatures/biz-1/retry.png';
    expect(await loadSignatureDataUri(key)).toBeNull();
    expect(await loadSignatureDataUri(key)).not.toBeNull();
    expect(getFileBuffer).toHaveBeenCalledTimes(2);
  });

  it('still rejects keys outside signatures/*.png without touching storage', async () => {
    expect(await loadSignatureDataUri('logos/x.png')).toBeNull();
    expect(getFileBuffer).not.toHaveBeenCalled();
  });
});
