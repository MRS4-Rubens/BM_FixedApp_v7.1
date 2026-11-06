import { parseStoredDisplayPrefs } from './display-prefs';
import type { InvoiceDisplayPrefs } from '@/lib/db/schema/_display_prefs';

export const LEGACY_DISPLAY_PREFS_KEY = 'bm_invoice_settings';
export const LEGACY_PREFS_CHANGED_EVENT = 'bm-legacy-display-prefs-changed';
const MAX_RAW_LENGTH = 10_000;
const RECOGNISED_KEYS = [
  'discEnabled',
  'showHsn',
  'showNextNo',
  'showSignatory',
  'enableFixedRows',
  'fixedRowsCount',
  'defaultGst',
] as const;

/** Safe against Safari private mode / blocked storage / SSR. Returns null on any problem. */
export function readLegacyDisplayPrefsRaw(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LEGACY_DISPLAY_PREFS_KEY);
    return raw !== null && raw.length <= MAX_RAW_LENGTH ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Returns normalized prefs, or null when the raw value is not JSON or has NO recognised key.
 * fixedRowsCount may legacy-arrive as numeric string. Mirrored legacy keys are ignored.
 */
export function parseLegacyDisplayPrefs(raw: string | null): InvoiceDisplayPrefs | null {
  if (raw === null || typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  const hasAnyKey = RECOGNISED_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(obj, key),
  );
  if (!hasAnyKey) {
    return null;
  }

  const cleaned: Record<string, unknown> = {};
  for (const key of RECOGNISED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      let val = obj[key];
      if (key === 'fixedRowsCount' && typeof val === 'string' && /^\d+$/.test(val.trim())) {
        val = Number(val.trim());
      }
      cleaned[key] = val;
    }
  }

  return parseStoredDisplayPrefs(cleaned);
}

export function clearLegacyDisplayPrefs(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_DISPLAY_PREFS_KEY);
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(LEGACY_PREFS_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

