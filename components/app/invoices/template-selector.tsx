'use client';

import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, Crown } from 'lucide-react';
import { canUseTemplate, type BusinessSubscriptionSource } from '@/lib/subscriptions/entitlements';
import { cn } from '@/lib/utils';

export interface TemplateOption {
  id: 'template_1' | 'template_2' | 'template_3' | 'template_4';
  name: string;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: 'template_1', name: 'Template 1 (Classic Slate)' },
  { id: 'template_2', name: 'Template 2 (Traditional Book Depot)' },
  { id: 'template_3', name: 'Template 3 (Pre-Printed Carbon Pad)' },
  { id: 'template_4', name: 'Template 4 (Modern Book Depot Replica)' },
];

const TEMPLATE_LABELS: Record<string, string> = Object.fromEntries(TEMPLATE_OPTIONS.map((t) => [t.id, t.name]));

export interface TemplateSelectorProps {
  value: string;
  onChange: (value: string) => void;
  business: BusinessSubscriptionSource | null | undefined;
  onUpgradeClick: () => void;
  compact?: boolean;
  className?: string;
  buttonClassName?: string;
  id?: string;
}

/**
 * Invoice template picker. Built on Base UI Select: the list renders in a portal, so a parent with
 * overflow (e.g. the preview modal's scrollable header) can no longer clip it, and it gets full
 * keyboard / screen-reader support. Picking a template the plan does not include opens the upgrade
 * prompt instead of changing the value.
 */
export function TemplateSelector({
  value,
  onChange,
  business,
  onUpgradeClick,
  compact = false,
  className,
  buttonClassName,
  id,
}: TemplateSelectorProps) {
  const selectedId = TEMPLATE_LABELS[value] ? value : TEMPLATE_OPTIONS[0].id;
  const hasAnyProBadge = TEMPLATE_OPTIONS.some((t) => !canUseTemplate(business, t.id).allowed);

  const handleValueChange = (templateId: string | null) => {
    if (!templateId) return;
    if (!canUseTemplate(business, templateId).allowed) {
      onUpgradeClick();
      return;
    }
    onChange(templateId);
  };

  return (
    <div className={cn('relative inline-block', compact ? 'w-[135px] sm:w-[150px]' : 'w-full', className)}>
      <Select.Root value={selectedId} onValueChange={handleValueChange} items={TEMPLATE_LABELS}>
        <Select.Trigger
          id={id}
          // The settings form labels it with <label htmlFor={id}>; the compact preview header has no visible label.
          aria-label={id ? undefined : 'Invoice template'}
          className={cn(
            'flex items-center justify-between text-left transition-all cursor-pointer',
            compact
              ? 'w-full rounded-md border border-primary/25 bg-background px-2.5 py-1.5 text-xs text-foreground shadow-[0_0_8px_rgba(59,130,246,0.06)] hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40'
              : 'h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-2xs hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600',
            buttonClassName
          )}
        >
          <Select.Value className="truncate pr-1.5 font-medium" />
          <Select.Icon className="shrink-0">
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform duration-200 [[data-popup-open]_&]:rotate-180" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          {/* z-[70]: above the invoice preview modal (z-50). */}
          <Select.Positioner side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false} className="z-[70] outline-none">
            <Select.Popup
              className={cn(
                'rounded-xl border border-slate-200/90 bg-white p-1 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-900',
                compact
                  ? hasAnyProBadge
                    ? 'w-[340px] max-w-[92vw]'
                    : 'w-[280px] max-w-[92vw]'
                  : 'w-[var(--anchor-width)] min-w-[340px] max-w-[92vw]'
              )}
            >
              <Select.List className="space-y-0.5">
                {TEMPLATE_OPTIONS.map((t) => {
                  const isAllowed = canUseTemplate(business, t.id).allowed;
                  return (
                    <Select.Item
                      key={t.id}
                      value={t.id}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-xs sm:text-[13px] text-left font-medium text-slate-700 cursor-pointer outline-none select-none transition-colors',
                        'data-[highlighted]:bg-slate-100/70 data-[highlighted]:text-slate-900 dark:text-slate-300 dark:data-[highlighted]:bg-slate-800/60 dark:data-[highlighted]:text-slate-100',
                        'data-[selected]:border-indigo-200/50 data-[selected]:bg-indigo-50/80 data-[selected]:font-bold data-[selected]:text-indigo-950 dark:data-[selected]:border-indigo-800/40 dark:data-[selected]:bg-indigo-950/40 dark:data-[selected]:text-indigo-200'
                      )}
                    >
                      <Select.ItemText className="truncate flex-1">{t.name}</Select.ItemText>
                      {!isAllowed ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black tracking-wide text-amber-800 shadow-2xs shrink-0 dark:text-amber-400">
                          <Crown aria-hidden="true" className="size-2.5 text-amber-700" />
                          PRO
                        </span>
                      ) : (
                        <Select.ItemIndicator className="shrink-0">
                          <Check aria-hidden="true" className="size-3.5 text-indigo-700" />
                        </Select.ItemIndicator>
                      )}
                    </Select.Item>
                  );
                })}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
