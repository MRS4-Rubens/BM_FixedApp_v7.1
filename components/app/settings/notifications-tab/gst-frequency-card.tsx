'use client';

import { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GstFilingFrequency } from '@/lib/db/domain-values';
import { saveGstFilingFrequency } from '@/lib/actions/notifications/save-gst-filing-frequency';
import { SERVER_UNREACHABLE_MESSAGE } from '@/lib/actions/_shared/client-errors';

const OPTIONS: readonly { value: GstFilingFrequency; label: string; hint: string }[] = [
  { value: 'monthly', label: 'Monthly', hint: 'GSTR-1 by the 11th and GSTR-3B by the 20th of every month.' },
  { value: 'quarterly', label: 'Quarterly (QRMP)', hint: 'GSTR-1 by the 13th and GSTR-3B by the 22nd/24th after each quarter.' },
  { value: 'not_filing', label: "I don't file GST returns", hint: 'No GST deadline reminders.' },
];

export interface GstFrequencyCardProps {
  readonly frequency: GstFilingFrequency | null;
  readonly registrationType: 'regular' | 'composition';
  readonly canEdit: boolean;
  readonly onSaved: (frequency: GstFilingFrequency) => void;
}

/** Feature C: how often the business files GST returns (owner sets it; it drives the deadline reminders). */
export function GstFrequencyCard({ frequency, registrationType, canEdit, onSaved }: GstFrequencyCardProps) {
  const [choice, setChoice] = useState<GstFilingFrequency | null>(frequency);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (registrationType === 'composition') {
    return (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs">
        <Header />
        <p className="mt-3 text-sm text-muted-foreground">
          Your business is registered under the composition scheme, which files CMP-08 and GSTR-4 instead of GSTR-1
          and GSTR-3B, so GST deadline reminders are off.
        </p>
      </section>
    );
  }

  async function save() {
    if (choice === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveGstFilingFrequency({ frequency: choice });
      if (result.success) {
        onSaved(result.data.frequency);
        setMessage({ ok: true, text: 'GST filing frequency saved.' });
      } else {
        setMessage({ ok: false, text: result.error.message });
      }
    } catch {
      setMessage({ ok: false, text: SERVER_UNREACHABLE_MESSAGE });
    } finally {
      setSaving(false); // BUG-05: never stuck on "Saving…"
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-4">
      <Header />
      {!canEdit && (
        <p className="text-xs text-muted-foreground">Only the business owner can change this.</p>
      )}
      {frequency === null && canEdit && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Choose how you file to start getting reminders 3 days before each due date.
        </p>
      )}
      <fieldset disabled={!canEdit || saving} className="relative grid grid-cols-1 gap-2.5 @min-[42rem]/notifications:grid-cols-3">
        <legend className="sr-only">GST filing frequency</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring/40',
              canEdit ? 'cursor-pointer hover:bg-accent/40' : 'cursor-default',
              choice === option.value ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/5' : 'border-border',
            )}
          >
            <input
              type="radio"
              name="gst_filing_frequency"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="mt-0.5 size-4 shrink-0 accent-indigo-600"
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="block text-sm font-bold text-foreground">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-[11px] text-muted-foreground">
        Reminders use the normal due dates. If the government extends a date in a particular month, the reminder
        still shows the normal date.
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={cn('min-w-0 flex-1 basis-full text-xs font-semibold sm:basis-0', message.ok ? 'text-emerald-700' : 'text-destructive')}>
              {message.text}
            </p>
          )}
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || choice === null || choice === frequency}
            className="ml-auto h-9 px-4 font-bold"
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save filing frequency
          </Button>
        </div>
      )}
    </section>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
        <CalendarClock className="size-4" />
      </div>
      <div>
        <h3 className="text-sm font-bold text-foreground">GST filing</h3>
        <p className="text-xs text-muted-foreground">How often your business files GSTR-1 and GSTR-3B.</p>
      </div>
    </div>
  );
}
