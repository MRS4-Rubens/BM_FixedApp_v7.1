import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  LEGACY_DISPLAY_PREFS_KEY,
  LEGACY_PREFS_CHANGED_EVENT,
  clearLegacyDisplayPrefs,
  parseLegacyDisplayPrefs,
  readLegacyDisplayPrefsRaw,
} from '@/lib/invoices/legacy-display-prefs';
import { DEFAULT_INVOICE_DISPLAY_PREFS } from '@/lib/invoices/display-prefs';

describe('legacy-display-prefs (FE-001)', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    const store: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = String(val);
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    };

    // Setup mock window with localStorage and EventTarget
    const eventListeners: Record<string, ((event?: unknown) => void)[]> = {};
    const mockWindow = {
      localStorage: mockLocalStorage,
      addEventListener: vi.fn((ev: string, cb: (event?: unknown) => void) => {
        eventListeners[ev] = eventListeners[ev] || [];
        eventListeners[ev].push(cb);
      }),
      removeEventListener: vi.fn((ev: string, cb: (event?: unknown) => void) => {
        if (!eventListeners[ev]) return;
        eventListeners[ev] = eventListeners[ev].filter((f) => f !== cb);
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        (eventListeners[event.type] || []).forEach((cb) => cb(event));
        return true;
      }),
    };

    // @ts-expect-error test mock
    global.window = mockWindow;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  describe('readLegacyDisplayPrefsRaw', () => {
    it('returns null when localStorage is empty', () => {
      expect(readLegacyDisplayPrefsRaw()).toBeNull();
    });

    it('returns raw string when localStorage contains data within size limit', () => {
      const data = JSON.stringify({ showHsn: false });
      window.localStorage.setItem(LEGACY_DISPLAY_PREFS_KEY, data);
      expect(readLegacyDisplayPrefsRaw()).toBe(data);
    });

    it('returns null when raw string exceeds MAX_RAW_LENGTH (10,000 chars)', () => {
      const huge = 'x'.repeat(10_001);
      window.localStorage.setItem(LEGACY_DISPLAY_PREFS_KEY, huge);
      expect(readLegacyDisplayPrefsRaw()).toBeNull();
    });

    it('returns null safely when window is undefined or localStorage throws', () => {
      vi.spyOn(window.localStorage, 'getItem').mockImplementationOnce(() => {
        throw new Error('SecurityError: access denied');
      });
      expect(readLegacyDisplayPrefsRaw()).toBeNull();
    });
  });

  describe('parseLegacyDisplayPrefs', () => {
    it('returns null for null, non-string, or non-JSON input', () => {
      expect(parseLegacyDisplayPrefs(null)).toBeNull();
      // @ts-expect-error runtime guard test
      expect(parseLegacyDisplayPrefs(1234)).toBeNull();
      expect(parseLegacyDisplayPrefs('invalid-json')).toBeNull();
    });

    it('returns null for JSON primitives, arrays, or objects with no recognized keys', () => {
      expect(parseLegacyDisplayPrefs('123')).toBeNull();
      expect(parseLegacyDisplayPrefs('"string"')).toBeNull();
      expect(parseLegacyDisplayPrefs('[]')).toBeNull();
      expect(parseLegacyDisplayPrefs('{}')).toBeNull();
      expect(parseLegacyDisplayPrefs(JSON.stringify({ unrelatedField: true }))).toBeNull();
    });

    it('parses valid legacy display preferences with full defaults fallback', () => {
      const legacy = {
        showHsn: false,
        enableFixedRows: false,
        fixedRowsCount: 20,
      };
      const result = parseLegacyDisplayPrefs(JSON.stringify(legacy));
      expect(result).toEqual({
        ...DEFAULT_INVOICE_DISPLAY_PREFS,
        showHsn: false,
        enableFixedRows: false,
        fixedRowsCount: 20,
      });
    });

    it('converts numeric string fixedRowsCount into integer', () => {
      const legacy = {
        fixedRowsCount: ' 17 ',
      };
      const result = parseLegacyDisplayPrefs(JSON.stringify(legacy));
      expect(result?.fixedRowsCount).toBe(17);
    });

    it('is immune to prototype pollution payload keys', () => {
      const malicious = '{"__proto__":{"polluted":true},"showHsn":false}';
      const result = parseLegacyDisplayPrefs(malicious);
      expect(result?.showHsn).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('clearLegacyDisplayPrefs', () => {
    it('removes the key from localStorage and dispatches LEGACY_PREFS_CHANGED_EVENT', () => {
      window.localStorage.setItem(LEGACY_DISPLAY_PREFS_KEY, '{"showHsn":false}');
      const listener = vi.fn();
      window.addEventListener(LEGACY_PREFS_CHANGED_EVENT, listener);

      clearLegacyDisplayPrefs();

      expect(window.localStorage.getItem(LEGACY_DISPLAY_PREFS_KEY)).toBeNull();
      expect(listener).toHaveBeenCalled();
    });
  });
});
