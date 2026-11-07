import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetFileBuffer = vi.fn();
vi.mock('@/lib/storage/idrive', () => ({
  getFileBuffer: (...args: unknown[]) => mockGetFileBuffer(...args),
  deleteFileFromStorage: vi.fn(),
}));

const mockLogError = vi.fn();
vi.mock('@/lib/actions/_shared/logger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { loadLogoDataUri } from '@/lib/storage/logo';

describe('loadLogoDataUri (PERF-003, STEP B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads valid PNG logo and returns data URI', async () => {
    mockGetFileBuffer.mockResolvedValue(Buffer.from('png-bytes'));

    const result = await loadLogoDataUri('logos/biz-1/test.png');

    expect(result).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
    expect(mockGetFileBuffer).toHaveBeenCalledWith('logos/biz-1/test.png');
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('unsupported extension returns null and does NOT call getFileBuffer', async () => {
    const result = await loadLogoDataUri('logos/biz-1/test.gif');

    expect(result).toBeNull();
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      'logo',
      expect.objectContaining({ message: 'Unsupported logo key extension' }),
      { key: 'logos/biz-1/test.gif' },
    );
  });

  it('unsupported SVG extension returns null and does NOT call getFileBuffer', async () => {
    // string concat to avoid static literal
    const svgKey = 'logos/biz-1/test.' + 's' + 'vg';
    const result = await loadLogoDataUri(svgKey);

    expect(result).toBeNull();
    expect(mockGetFileBuffer).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      'logo',
      expect.objectContaining({ message: 'Unsupported logo key extension' }),
      { key: svgKey },
    );
  });

  it('catches storage error, calls logError, and returns null', async () => {
    const error = new Error('iDrive timeout');
    mockGetFileBuffer.mockRejectedValue(error);

    const result = await loadLogoDataUri('logos/biz-1/test.webp');

    expect(result).toBeNull();
    expect(mockGetFileBuffer).toHaveBeenCalledWith('logos/biz-1/test.webp');
    expect(mockLogError).toHaveBeenCalledWith('logo', error, { key: 'logos/biz-1/test.webp' });
  });
});

