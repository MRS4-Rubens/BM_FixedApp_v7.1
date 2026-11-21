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
 * - Each browser tab keeps its own copy (two New Invoice tabs never overwrite each other). A NEW tab picks up the most
 *   recent copy that no open tab is still using (open tabs refresh an "alive" stamp every few seconds).
 * - Restored when the user comes back to New Invoice (with a "Discard" option).
 * - Removed when the invoice is saved to the database (Save Draft / Finalize), on Sign Out, on Discard, and when it
 *   has not been changed for UNSAVED_INVOICE_TTL_MS.
 */

const KEY_PREFIX = 'bizfolio:unsaved-invoice:v2:';
const TAB_ID_PREFIX = 'bizfolio:unsaved-invoice-tab:';
const CLEAR_EVENT = 'bizfolio:unsaved-invoice-clear';
const UNSAVED_INVOICE_TTL_MS = 30 * 60 * 1000;
const SAVE_DELAY_MS = 800;
const ALIVE_EVERY_MS = 5_000;
/** A copy whose tab has not stamped "alive" for this long is treated as abandoned and may be adopted by a new tab. */
const ABANDONED_AFTER_MS = 15_000;

interface StoredDraft {
  savedAt: number;
  aliveAt: number;
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

/** This tab's own id, or null if the tab has none yet (a freshly opened tab). */
function readTabId(businessId: string): string | null {
  try {
    return window.sessionStorage.getItem(TAB_ID_PREFIX + businessId);
  } catch {
    return null;
  }
}

function writeTabId(businessId: string, tabId: string) {
  try {
    window.sessionStorage.setItem(TAB_ID_PREFIX + businessId, tabId);
  } catch {
    /* storage blocked: the id lives only for this page visit */
  }
}

/**
 * Sign Out: forget every unsaved invoice kept in this browser (any business). Open forms are told first, so a pending
 * save cannot write a copy back after it was cleared. Call only after sign-out succeeded.
 */
export function clearAllUnsavedInvoiceDrafts() {
  try {
    window.dispatchEvent(new Event(CLEAR_EVENT));
  } catch {
    /* no window */
  }
  storageKeys(KEY_PREFIX).forEach(safeRemove);
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
  const keyRef = useRef<string | null>(null);
  const activeRef = useRef(enabled);
  const customerRef = useRef(selectedCustomer);
  const pristineRef = useRef(JSON.stringify(defaultValues));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const savedAtRef = useRef(0);

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
    try {
      const payload: StoredDraft = {
        savedAt: savedAtRef.current,
        aliveAt: savedAtRef.current,
        values,
        customer: customerRef.current,
      };
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* storage full or blocked: the beforeunload warning below still protects reloads */
    }
  }, [methods]);

  // Arrival: pick this tab's key, drop expired copies, restore. Done in a timer so no state is set during the effect.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const now = Date.now();
      const prefix = `${KEY_PREFIX}${businessId}:`;
      for (const k of storageKeys(prefix)) {
        const d = safeRead(k);
        if (!d || now - d.savedAt > UNSAVED_INVOICE_TTL_MS) safeRemove(k);
      }

      let tabId = readTabId(businessId);
      let stored = tabId ? safeRead(entryKey(businessId, tabId)) : null;
      if (!tabId) {
        // Fresh tab: adopt the newest copy that no open tab is still using (e.g. the tab that was closed).
        const abandoned = storageKeys(prefix)
          .map((k) => ({ k, d: safeRead(k) }))
          .filter((x): x is { k: string; d: StoredDraft } => !!x.d && now - (x.d.aliveAt ?? x.d.savedAt) > ABANDONED_AFTER_MS)
          .sort((a, b) => b.d.savedAt - a.d.savedAt)[0];
        tabId = abandoned ? abandoned.k.slice(prefix.length) : newTabId();
        stored = abandoned?.d ?? null;
        writeTabId(businessId, tabId);
      }
      keyRef.current = entryKey(businessId, tabId);

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
      if (!d) return;
      try {
        window.localStorage.setItem(key, JSON.stringify({ ...d, aliveAt: Date.now() }));
      } catch {
        /* storage blocked */
      }
    }, ALIVE_EVERY_MS);
    const onPageHide = () => {
      if (timerRef.current) writeNow();
    };
    const onClear = () => {
      activeRef.current = false;
      dirtyRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener(CLEAR_EVENT, onClear);
    return () => {
      clearInterval(alive);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener(CLEAR_EVENT, onClear);
    };
  }, [enabled, writeNow]);

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
