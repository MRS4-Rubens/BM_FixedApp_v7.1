import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDesktopView,
  canOfferDesktopView,
  DESKTOP_VIEW_STORAGE_KEY,
  isDesktopViewEnabled,
  setDesktopView,
} from '@/lib/desktop-view';

const ORIGINAL = 'width=device-width, initial-scale=1';

/** Minimal stand-ins for the few browser objects lib/desktop-view.ts touches (no DOM library in this project). */
function installBrowser(screenWidth: number, screenHeight: number) {
  const attrs = new Map<string, string>();
  const meta = {
    content: ORIGINAL,
    hasAttribute: (name: string) => attrs.has(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
  };
  const store = new Map<string, string>();
  vi.stubGlobal('document', { querySelector: () => meta });
  vi.stubGlobal('window', {
    screen: { width: screenWidth, height: screenHeight },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    dispatchEvent: () => true,
  });
  return { meta, store };
}

describe('Desktop view (mobile plan step 7)', () => {
  let browser: ReturnType<typeof installBrowser>;
  beforeEach(() => {
    browser = installBrowser(390, 844);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is offered only on phone-sized screens', () => {
    expect(canOfferDesktopView()).toBe(true);
    installBrowser(844, 390); // phone in landscape
    expect(canOfferDesktopView()).toBe(true);
    installBrowser(820, 1180); // tablet
    expect(canOfferDesktopView()).toBe(false);
  });

  it('switches the viewport to 1280px scaled to the phone width, and restores the original', () => {
    applyDesktopView(true);
    expect(browser.meta.content).toBe('width=1280, initial-scale=0.305');
    applyDesktopView(false);
    expect(browser.meta.content).toBe(ORIGINAL);
  });

  it('remembers the choice per device and clears it when turned off', () => {
    expect(isDesktopViewEnabled()).toBe(false);
    setDesktopView(true);
    expect(browser.store.get(DESKTOP_VIEW_STORAGE_KEY)).toBe('1');
    expect(isDesktopViewEnabled()).toBe(true);
    setDesktopView(false);
    expect(browser.store.has(DESKTOP_VIEW_STORAGE_KEY)).toBe(false);
    expect(browser.meta.content).toBe(ORIGINAL);
  });
});
