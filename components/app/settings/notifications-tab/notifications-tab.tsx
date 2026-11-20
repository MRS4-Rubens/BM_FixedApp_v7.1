'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bell, Loader2, Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NotificationCategory } from '@/lib/db/domain-values';
import { CATEGORY_LABELS } from '@/lib/notifications/catalog';
import type { NotificationPrefs } from '@/lib/notifications/prefs';
import {
  getNotificationSettings,
  saveNotificationPreferences,
  type NotificationSettings,
} from '@/lib/actions/notifications/notification-settings';
import { GstFrequencyCard } from './gst-frequency-card';

/**
 * Feature C: Settings → Notifications. Every person (owner, staff, accountant) manages their OWN e-mail choices;
 * only the switches for categories their role can receive are shown. The GST filing frequency card is a
 * business setting (owner edits; others see it read-only).
 */
export function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await getNotificationSettings({});
    if (result.success) {
      setSettings(result.data);
      setPrefs(result.data.prefs);
    } else {
      setLoadError(result.error.message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center space-y-3">
        <AlertCircle className="size-8 text-destructive mx-auto" />
        <p className="text-sm font-bold text-foreground">Failed to load notification settings</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="gap-1.5 font-bold text-xs">
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (!settings || !prefs) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true">
        <div className="h-24 rounded-xl bg-muted/50 border border-border" />
        <div className="h-56 rounded-xl bg-muted/50 border border-border" />
      </div>
    );
  }

  const dirty = JSON.stringify(prefs) !== JSON.stringify(settings.prefs);

  function toggleCategory(category: NotificationCategory, value: boolean) {
    setMessage(null);
    setPrefs((current) => (current ? { ...current, email: { ...current.email, [category]: value } } : current));
  }

  async function save() {
    if (!prefs || !settings) return;
    setSaving(true);
    setMessage(null);
    const result = await saveNotificationPreferences({ email: { ...prefs.email }, digest: prefs.digest });
    setSaving(false);
    if (result.success) {
      setSettings({ ...settings, prefs: result.data.prefs });
      setPrefs(result.data.prefs);
      setMessage({ ok: true, text: 'Your e-mail choices are saved.' });
    } else {
      setMessage({ ok: false, text: result.error.message });
    }
  }

  return (
    <div className="@container/notifications space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-foreground shrink-0" aria-hidden="true" />
          <h2 className="text-xl font-bold font-heading text-foreground uppercase">Notifications</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          The bell at the top of every page always shows your notifications. Choose which ones also come by e-mail.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
            <Mail className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">E-mail notifications</h3>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {settings.email ? `Sent to ${settings.email}` : 'Your account has no e-mail address, so nothing can be e-mailed.'}
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {settings.categories.map((category) => (
            <li key={category}>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-accent/40">
                <span>
                  <span id={`notify-${category}-label`} className="block text-sm font-bold text-foreground">
                    {CATEGORY_LABELS[category].label}
                  </span>
                  <span id={`notify-${category}-hint`} className="block text-xs text-muted-foreground">
                    {CATEGORY_LABELS[category].description}
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-labelledby={`notify-${category}-label`}
                  aria-describedby={`notify-${category}-hint`}
                  aria-checked={prefs.email[category]}
                  checked={prefs.email[category]}
                  onChange={(event) => toggleCategory(category, event.target.checked)}
                  disabled={saving}
                  className="mt-1 size-4 shrink-0 accent-indigo-600 cursor-pointer"
                />
              </label>
            </li>
          ))}
        </ul>

        <fieldset className="space-y-2" disabled={saving}>
          <legend className="text-sm font-bold text-foreground">Routine updates</legend>
          <div className="grid grid-cols-1 gap-2.5 @min-[30rem]/notifications:grid-cols-2">
            {(
              [
                { value: 'daily', title: 'Daily summary', label: 'One summary e-mail every morning (around 9 AM)' },
                { value: 'off', title: 'No routine summary', label: 'No summary e-mail (urgent ones still come straight away)' },
              ] as const
            ).map((option) => (
              <label key={option.value} className={cn(
                'flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3 text-sm text-foreground transition-colors cursor-pointer hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring/40',
                prefs.digest === option.value ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-border',
                saving && 'cursor-wait opacity-60',
              )}>
                <input
                  type="radio"
                  name="digest"
                  value={option.value}
                  checked={prefs.digest === option.value}
                  onChange={() => {
                    setMessage(null);
                    setPrefs({ ...prefs, digest: option.value });
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-indigo-600"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="block text-sm font-bold">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.label}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Urgent means: your payment was approved or rejected, or your trial or plan ends tomorrow.
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={cn('min-w-0 flex-1 basis-full text-xs font-semibold sm:basis-0', message.ok ? 'text-emerald-700' : 'text-destructive')}>
              {message.text}
            </p>
          )}
          <Button type="button" onClick={() => void save()} disabled={saving || !dirty} className="ml-auto h-9 px-4 font-bold">
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save e-mail choices
          </Button>
        </div>
      </section>

      {settings.gst && settings.categories.includes('gst') && (
        <GstFrequencyCard
          frequency={settings.gst.frequency}
          registrationType={settings.gst.registrationType}
          canEdit={settings.role === 'owner'}
          onSaved={(frequency) =>
            setSettings((current) => (current && current.gst ? { ...current, gst: { ...current.gst, frequency } } : current))
          }
        />
      )}
    </div>
  );
}
