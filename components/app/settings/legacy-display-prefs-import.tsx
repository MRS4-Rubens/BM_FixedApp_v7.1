'use client';

import { useSyncExternalStore, useMemo, useState, useTransition } from 'react';
import {
  readLegacyDisplayPrefsRaw,
  parseLegacyDisplayPrefs,
  clearLegacyDisplayPrefs,
  LEGACY_PREFS_CHANGED_EVENT,
} from '@/lib/invoices/legacy-display-prefs';
import { importLegacyDisplayPrefs } from '@/lib/actions/invoices/import-legacy-display-prefs';
import { Sparkles, AlertCircle, Loader2, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  window.addEventListener(LEGACY_PREFS_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(LEGACY_PREFS_CHANGED_EVENT, callback);
  };
}

export function LegacyDisplayPrefsImport() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, readLegacyDisplayPrefsRaw, () => null);
  const parsed = useMemo(() => parseLegacyDisplayPrefs(raw), [raw]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);

  if (!parsed) {
    return null;
  }

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await importLegacyDisplayPrefs({ display_prefs: parsed });
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      clearLegacyDisplayPrefs();
      setSuccess(true);
      router.refresh();
    });
  };

  const handleDiscard = () => {
    clearLegacyDisplayPrefs();
  };

  return (
    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-900 text-white shadow-xs">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              Legacy Browser Preferences Found
            </h4>
            <p className="mt-0.5 text-xs text-slate-600 font-medium leading-relaxed">
              We found invoice display preferences saved in this browser. Import them into your account so they are used everywhere.
            </p>
            {error && (
              <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <Check className="size-3.5 shrink-0" />
                <span>Preferences imported to your account.</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition-colors disabled:opacity-50"
          >
            {isPending && <Loader2 className="size-3 animate-spin shrink-0" />}
            Save to account
          </button>
        </div>
      </div>
    </div>
  );
}
