import type { ActionResult } from '@/lib/actions/_shared/types';

export type OpenSignedPdfResult = { ok: true } | { ok: false; message: string };

/**
 * Opens a signed PDF URL in a new tab without being popup-blocked: the tab is opened SYNCHRONOUSLY inside the user's
 * click (browsers only allow window.open during the click), then pointed at the signed URL once the server action
 * returns. MUST be called directly in the click handler, before any other await.
 */
export async function openSignedPdf(
  getUrl: () => Promise<ActionResult<{ url: string }>>,
  fallbackMessage = 'Could not open the PDF. Please try again.',
): Promise<OpenSignedPdfResult> {
  const tab = typeof window !== 'undefined' && typeof window.open === 'function' ? window.open('', '_blank') : null;
  if (tab) {
    tab.opener = null;
  }

  try {
    const res = await getUrl();
    if (res.success) {
      if (tab) {
        tab.location.href = res.data.url;
      } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
      }
      return { ok: true };
    }
    tab?.close();
    return { ok: false, message: res.error.message || fallbackMessage };
  } catch {
    tab?.close();
    return { ok: false, message: fallbackMessage };
  }
}

