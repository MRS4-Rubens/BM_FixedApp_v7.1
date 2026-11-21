/**
 * "Desktop view" on phones (mobile plan step 7). Opt-in, off by default, remembered per device.
 *
 * Like a browser's "Desktop site" option: the viewport meta switches to width=1280, so the phone lays the app out at
 * its real desktop width (the >= 1280px layout) and shows the whole page scaled to fit the screen. No layout code is
 * duplicated; turning it off restores the original viewport (the normal phone layout).
 * Offered only on phone-sized screens (shorter side < 768 CSS px of the physical screen); tablets and computers
 * already get the desktop layout.
 */
export const DESKTOP_VIEW_STORAGE_KEY = 'bizfolio:desktop-view';
export const DESKTOP_VIEW_CHANGE_EVENT = 'bizfolio:desktop-view-change';
export const DESKTOP_VIEW_WIDTH = 1280;

const ORIGINAL_ATTR = 'data-original-content';

export function canOfferDesktopView(): boolean {
  if (typeof window === 'undefined' || !window.screen) return false;
  return Math.min(window.screen.width, window.screen.height) < 768;
}

export function isDesktopViewEnabled(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_VIEW_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Point the viewport meta at the desktop width, or back at its original content. */
export function applyDesktopView(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  if (!meta.hasAttribute(ORIGINAL_ATTR)) meta.setAttribute(ORIGINAL_ATTR, meta.content);
  if (!enabled) {
    meta.content = meta.getAttribute(ORIGINAL_ATTR) || 'width=device-width, initial-scale=1';
    return;
  }
  // Zoom out so the whole 1280px page fits the phone's width; pinch-zoom still works.
  const scale = Math.min(1, window.screen.width / DESKTOP_VIEW_WIDTH).toFixed(3);
  meta.content = `width=${DESKTOP_VIEW_WIDTH}, initial-scale=${scale}`;
}

export function setDesktopView(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(DESKTOP_VIEW_STORAGE_KEY, '1');
    else window.localStorage.removeItem(DESKTOP_VIEW_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the switch still works for this page view.
  }
  applyDesktopView(enabled);
  window.dispatchEvent(new Event(DESKTOP_VIEW_CHANGE_EVENT));
}
