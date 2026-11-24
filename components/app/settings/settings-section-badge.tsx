import { cn } from '@/lib/utils';

/**
 * UI stage 1: the round section number used across Settings (same size and colours as Business Profile and
 * Invoice Settings). It sits next to each section's <h3>, which is how the Settings side panel finds the parts
 * for "On this page".
 */
const TONES = {
  emerald: 'bg-emerald-800',
  amber: 'bg-amber-800',
  rose: 'bg-rose-900',
  blue: 'bg-blue-900',
} as const;

export function SettingsSectionBadge({ number, tone }: { number: number; tone: keyof typeof TONES }) {
  return (
    <div
      className={cn(
        'flex size-5.5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white shadow-xs',
        TONES[tone]
      )}
    >
      {number}
    </div>
  );
}
