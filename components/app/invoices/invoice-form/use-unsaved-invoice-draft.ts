'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { CustomerOption } from '@/lib/pickers/types';

/**
 * Browser-only safety net for a NEW invoice that has not been saved yet: an accidental back-swipe, reload or closed
 * tab no longer loses it. Nothing goes to the server or the database (no Neon / Render cost).
 *
 * - Saved in this browser's localStorage about once a second while typing.
 * - Restored when the user comes back to New Invoice (with a "Discard" option).
 * - Removed when the invoice is saved to the database (Save Draft / Finalize), on Sign Out, on Discard, and when it
 *   has not been touched for UNSAVED_INVOICE_TTL_MS.
 */

const KEY_PREFIX = 'bizfolio:unsaved-invoice:v1:';
const UNSAVED_INVOICE_TTL_MS = 30 * 60 * 1000;
const SAVE_DELAY_MS = 800;

interface StoredDraft {
  savedAt: number;
  values: InvoiceDraftInput;
  customer: CustomerOption | null;
}

function storageKey(businessId: string) {
  return `${KEY_PREFIX}${businessId}:new`;
}

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

/** Sign Out: forget every unsaved invoice kept in this browser (any business). */
export function clearAllUnsavedInvoiceDrafts() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage blocked: nothing stored */
  }
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
  const key = storageKey(businessId);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const activeRef = useRef(enabled);
  const customerRef = useRef(selectedCustomer);
  const pristineRef = useRef(JSON.stringify(defaultValues));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    customerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  // Restore once on arrival. Done in a timer so the form has mounted and no state is set during the effect itself.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const stored = safeRead(key);
      if (!stored) return;
      if (Date.now() - stored.savedAt > UNSAVED_INVOICE_TTL_MS) {
        safeRemove(key);
        return;
      }
      methods.reset({ ...defaultValues, ...stored.values });
      setSelectedCustomer(stored.customer ?? null);
      dirtyRef.current = true;
      setRestoredAt(stored.savedAt);
    }, 0);
    return () => clearTimeout(t);
    // Runs once per page visit; defaultValues / methods are stable for the life of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // Save while typing (debounced). An untouched form removes the stored copy instead.
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = methods.subscribe({
      formState: { values: true },
      callback: () => {
      if (!activeRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!activeRef.current) return;
        const values = methods.getValues();
        if (JSON.stringify(values) === pristineRef.current) {
          dirtyRef.current = false;
          safeRemove(key);
          return;
        }
        dirtyRef.current = true;
        try {
          const payload: StoredDraft = { savedAt: Date.now(), values, customer: customerRef.current };
          window.localStorage.setItem(key, JSON.stringify(payload));
        } catch {
          /* storage full or blocked: the beforeunload warning below still protects reloads */
        }
      }, SAVE_DELAY_MS);
      },
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, key, methods]);

  // Laptop reload / tab close with unsaved work: the browser's own "Leave site?" prompt.
  useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!activeRef.current || !dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled]);

  /** The invoice now exists in the database: stop keeping a browser copy for this page visit. */
  const markSavedToServer = useCallback(() => {
    activeRef.current = false;
    dirtyRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    safeRemove(key);
    setRestoredAt(null);
  }, [key]);

  /** "Discard" on the restore bar: back to an empty invoice. */
  const discard = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    safeRemove(key);
    dirtyRef.current = false;
    methods.reset(defaultValues);
    setSelectedCustomer(null);
    setRestoredAt(null);
  }, [key, methods, defaultValues, setSelectedCustomer]);

  const dismissNotice = useCallback(() => setRestoredAt(null), []);

  return { restoredAt, discard, dismissNotice, markSavedToServer };
}
