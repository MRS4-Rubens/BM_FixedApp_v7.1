import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openSignedPdf } from '@/lib/pdf/open-signed-pdf';

describe('openSignedPdf', () => {
  let mockTab: {
    opener: unknown;
    location: { href: string };
    close: ReturnType<typeof vi.fn>;
  };
  let windowOpenMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockTab = {
      opener: {},
      location: { href: '' },
      close: vi.fn(),
    };
    windowOpenMock = vi.fn().mockReturnValue(mockTab);
    vi.stubGlobal('window', {
      open: windowOpenMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('success sets tab.location.href, nulls opener, and returns ok: true', async () => {
    const getUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: 'https://example.com/signed.pdf' },
    });

    const result = await openSignedPdf(getUrl);

    expect(windowOpenMock).toHaveBeenCalledWith('', '_blank');
    expect(mockTab.opener).toBeNull();
    expect(mockTab.location.href).toBe('https://example.com/signed.pdf');
    expect(mockTab.close).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('failure closes the tab and returns the server error message', async () => {
    const getUrl = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'Archived copy is not available yet.' },
    });

    const result = await openSignedPdf(getUrl);

    expect(mockTab.close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      message: 'Archived copy is not available yet.',
    });
  });

  it('failure returns fallback message when server message is empty', async () => {
    const getUrl = vi.fn().mockResolvedValue({
      success: false,
      error: { message: '' },
    });

    const result = await openSignedPdf(getUrl, 'Custom fallback message');

    expect(mockTab.close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      message: 'Custom fallback message',
    });
  });

  it('thrown error closes the tab and returns the fallback message', async () => {
    const getUrl = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await openSignedPdf(getUrl, 'Custom network fallback');

    expect(mockTab.close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      message: 'Custom network fallback',
    });
  });

  it('popup blocked (window.open returns null) on success falls back to window.open(url, "_blank", "noopener,noreferrer")', async () => {
    windowOpenMock.mockReturnValue(null);

    const getUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: 'https://example.com/signed.pdf' },
    });

    const result = await openSignedPdf(getUrl);

    expect(windowOpenMock).toHaveBeenNthCalledWith(1, '', '_blank');
    expect(windowOpenMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/signed.pdf',
      '_blank',
      'noopener,noreferrer'
    );
    expect(result).toEqual({ ok: true });
  });

  it('calls window.open("", "_blank") synchronously BEFORE getUrl is awaited', async () => {
    const callOrder: string[] = [];

    windowOpenMock.mockImplementation((url: string, target: string) => {
      callOrder.push(`window.open(${url}, ${target})`);
      return mockTab;
    });

    const getUrl = vi.fn().mockImplementation(async () => {
      callOrder.push('getUrl:start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      callOrder.push('getUrl:end');
      return {
        success: true,
        data: { url: 'https://example.com/signed.pdf' },
      };
    });

    await openSignedPdf(getUrl);

    expect(callOrder[0]).toBe('window.open(, _blank)');
    expect(callOrder[1]).toBe('getUrl:start');
    expect(callOrder[2]).toBe('getUrl:end');
  });
});

