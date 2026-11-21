'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { CustomerOption } from '@/lib/pickers/types';

/**
 * Browser-only safety net for a NEW invoice that has not been saved yet: an accidental back-swipe, reload or closed
 * tab no longer loses it. Nothing goes to the server or the database (no Neon / Render cost).
 *
 * - Saved in this browser's localStorage shortly after each change, and immediately when the page is left.
 * - Every open form writes only to its own copy (two New Invoice tabs never overwrite each other). A form that is left
 *   (back, reload, closed tab, another page) flushes and marks its copy "released". A newly opened form adopts the
 *   newest released copy, or one whose form stopped stamping "alive" (crash), and moves it to its own key.
 * - Sign Out in any tab stops every open form (also in other tabs) before the copies are removed.
 * - Restored when the user comes back to New Invoice (with a "Discard" option).
 * - Removed when the invoice is saved to the database (Save Draft / Finalize), on Sign Out, on Discard, and when it
 *   has not been changed for UNSAVED_INVOICE_TTL_MS.
 */

const KEY_PREFIX = 'bizfolio:unsaved-invoice:v2:';
const CLEAR_EVENT = 'bizfolio:unsaved-invoice-clear';
/** Written on sign-out so forms open in OTHER tabs stop too (they receive a 'storage' event). */
const SIGNOUT_KEY = 'bizfolio:unsaved-invoice-signout';
const UNSAVED_INVOICE_TTL_MS = 30 * 60 * 1000;
const SAVE_DELAY_MS = 800;
const ALIVE_EVERY_MS = 5_000;
/** A copy whose tab has not stamped "alive" for this long is treated as abandoned and may be adopted by a new tab. */
const ABANDONED_AFTER_MS = 15_000;

interface StoredDraft {
  savedAt: number;
  aliveAt: number;
  /** Set when the owning form was left; such a copy may be adopted at once. */
  releasedAt?: number;
  values: InvoiceDraftInput;
  customer: CustomerOption | null;
}

const entryKey = (businessId: string, tabId: string) => `${KEY_PREFIX}${businessId}:${tabId}`;

function safeRead(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed?.savedAt !== 'number' || !parsed.values) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing to remove */
  }
}

function storageKeys(prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
  } catch {
    /* storage blocked */
  }
  return keys;
}

function newTabId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sign Out: forget every unsaved invoice kept in this browser (any business). Open forms are told first, so a pending
 * save cannot write a copy back after it was cleared. Call only after sign-out succeeded.
 */
export function clearAllUnsavedInvoiceDrafts() {
  try {
    window.dispatchEvent(new Event(CLEAR_EVENT));
    window.localStorage.setItem(SIGNOUT_KEY, String(Date.now()));
  } catch {
    /* no window / storage blocked */
  }
  storageKeys(KEY_PREFIX).forEach(safeRemove);
}

/**
 * True when a sign-out happened (in any tab) after this form was opened. Checked synchronously right before every
 * write, so a form in another tab cannot write a copy back in the gap before its 'storage' event arrives.
 * PURE given the stored marker, exported for tests.
 */
export function signedOutSince(markerValue: string | null, formOpenedAt: number): boolean {
  const at = markerValue ? Number(markerValue) : NaN;
  return Number.isFinite(at) && at >= formOpenedAt;
}

function readSignoutMarker(): string | null {
  try {
    return window.localStorage.getItem(SIGNOUT_KEY);
  } catch {
    return null;
  }
}

function writeEntry(key: string, d: StoredDraft, formOpenedAt: number): boolean {
  if (signedOutSince(readSignoutMarker(), formOpenedAt)) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* storage full or blocked */
  }
  return true;
}

export function useUnsavedInvoiceDraft({
  enabled,
  businessId,
  methods,
  defaultValues,
  selectedCustomer,
  setSelectedCustomer,
}: {
  /** Only for a brand-new invoice (no database draft yet). */
  enabled: boolean;
  businessId: string;
  methods: UseFormReturn<InvoiceDraftInput>;
  defaultValues: InvoiceDraftInput;
  selectedCustomer: CustomerOption | null;
  setSelectedCustomer: (c: CustomerOption | null) => void;
}) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  /** This form's own copy. A fresh id per form, so no two open forms ever share a key. */
  const keyRef = useRef<string | null>(null);
  const activeRef = useRef(enabled);
  const customerRef = useRef(selectedCustomer);
  const pristineRef = useRef(JSON.stringify(defaultValues));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const savedAtRef = useRef(0);
  /** When this form was opened; a sign-out marker newer than this blocks every write from this form. */
  const openedAtRef = useRef(0);

  useEffect(() => {
    customerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  /** Write the current form now (or remove the copy if the form is back to empty). */
  const writeNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const key = keyRef.current;
    if (!activeRef.current || !key) return;
    const values = methods.getValues();
    if (JSON.stringify(values) === pristineRef.current) {
      dirtyRef.current = false;
      safeRemove(key);
      return;
    }
    dirtyRef.current = true;
    savedAtRef.current = Date.now();
    // Storage full or blocked: writeEntry ignores it; the beforeunload warning below still protects reloads.
    const written = writeEntry(
      key,
      { savedAt: savedAtRef.current, aliveAt: savedAtRef.current, values, customer: customerRef.current },
      openedAtRef.current,
    );
    if (!written) {
      // Signed out in another tab: stop for good (the 'storage' event may not have arrived yet).
      activeRef.current = false;
      dirtyRef.current = false;
    }
  }, [methods]);

  /** Leaving this form: flush the last edits, then mark the copy free for the next New Invoice to adopt. */
  const release = useCallback(() => {
    if (timerRef.current) writeNow();
    const key = keyRef.current;
    if (!activeRef.current || !key) return;
    const d = safeRead(key);
    if (d && !d.releasedAt) writeEntry(key, { ...d, releasedAt: Date.now() }, openedAtRef.current);
  }, [writeNow]);

  // Arrival: drop expired copies, take a fresh own key, adopt a free copy and restore it. Done in a timer so no state is set during the effect.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const now = Date.now();
      openedAtRef.current = now;
      const prefix = `${KEY_PREFIX}${businessId}:`;
      for (const k of storageKeys(prefix)) {
        const d = safeRead(k);
        if (!d || now - d.savedAt > UNSAVED_INVOICE_TTL_MS) safeRemove(k);
      }

      const ownKey = entryKey(businessId, newTabId());
      keyRef.current = ownKey;
      // Adopt the newest copy whose form was left (released) or stopped stamping "alive"; move it to our own key.
      const candidate = storageKeys(prefix)
        .map((k) => ({ k, d: safeRead(k) }))
        .filter(
          (x): x is { k: string; d: StoredDraft } =>
            !!x.d && (!!x.d.releasedAt || now - (x.d.aliveAt ?? x.d.savedAt) > ABANDONED_AFTER_MS),
        )
        .sort((x, y) => y.d.savedAt - x.d.savedAt)[0];
      const stored = candidate?.d ?? null;
      if (candidate) {
        safeRemove(candidate.k);
        writeEntry(ownKey, { ...candidate.d, aliveAt: now, releasedAt: undefined }, now);
      }
      if (!stored) return;
      methods.reset({ ...defaultValues, ...stored.values });
      setSelectedCustomer(stored.customer ?? null);
      dirtyRef.current = true;
      savedAtRef.current = stored.savedAt;
      setRestoredAt(stored.savedAt);
    }, 0);
    return () => clearTimeout(t);
    // Runs once per page visit; defaultValues / methods are stable for the life of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, businessId]);

  // Every change marks the form unsaved at once; the storage write itself is debounced.
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = methods.subscribe({
      formState: { values: true },
      callback: () => {
        if (!activeRef.current) return;
        dirtyRef.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(writeNow, SAVE_DELAY_MS);
      },
    });
    return () => {
      unsubscribe();
      // Leaving the page inside the debounce window must not drop the last edits.
      if (timerRef.current) writeNow();
    };
  }, [enabled, methods, writeNow]);

  // Open tab: keep this copy marked "in use", flush on pagehide, and stop on Sign Out.
  useEffect(() => {
    if (!enabled) return;
    const alive = setInterval(() => {
      const key = keyRef.current;
      if (!activeRef.current || !key || !dirtyRef.current) return;
      const d = safeRead(key);
      if (!d || d.releasedAt) return;
      if (!writeEntry(key, { ...d, aliveAt: Date.now() }, openedAtRef.current)) activeRef.current = false;
    }, ALIVE_EVERY_MS);
    const onPageHide = () => release();
    // Back/forward cache restored this page: take our copy back (unless another form already adopted it).
    const onPageShow = (e: PageTransitionEvent) => {
      const key = keyRef.current;
      if (!e.persisted || !activeRef.current || !key) return;
      const d = safeRead(key);
      if (d?.releasedAt) writeEntry(key, { ...d, releasedAt: undefined, aliveAt: Date.now() }, openedAtRef.current);
    };
    const onClear = () => {
      activeRef.current = false;
      dirtyRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // Sign-out in another tab arrives as a 'storage' event for SIGNOUT_KEY.
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNOUT_KEY) onClear();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener(CLEAR_EVENT, onClear);
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(alive);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener(CLEAR_EVENT, onClear);
      window.removeEventListener('storage', onStorage);
      // Navigating away inside the app (form unmounts): hand the copy over to the next New Invoice.
      release();
    };
  }, [enabled, writeNow, release]);

  // Laptop reload / tab close with unsaved work: the browser's own "Leave site?" prompt.
  useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!activeRef.current || !dirtyRef.current) return;
      if (timerRef.current) writeNow();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled, writeNow]);

  /** The invoice now exists in the database: stop keeping a browser copy for this page visit. */
  const markSavedToServer = useCallback(() => {
    activeRef.current = false;
    dirtyRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (keyRef.current) safeRemove(keyRef.current);
    setRestoredAt(null);
  }, []);

  /** "Discard" on the restore bar: back to an empty invoice. */
  const discard = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (keyRef.current) safeRemove(keyRef.current);
    dirtyRef.current = false;
    methods.reset(defaultValues);
    setSelectedCustomer(null);
    setRestoredAt(null);
  }, [methods, defaultValues, setSelectedCustomer]);

  const dismissNotice = useCallback(() => setRestoredAt(null), []);

  return { restoredAt, discard, dismissNotice, markSavedToServer };
}
