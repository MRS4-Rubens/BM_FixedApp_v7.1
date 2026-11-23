'use client';

import { useEffect, useState, type RefObject } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * UI stage 1 (Settings layout C): the right-hand control panel of the Settings page.
 *  1. The settings sections, in groups.
 *  2. "On this page": jump links to the numbered parts of the open section, read from the rendered page (each
 *     numbered header is a round badge + an <h3>), so the forms need no extra markup.
 *  3. A Save box that stays in view and submits the open section's own form (`<button form=…>`), so validation,
 *     server checks and error messages are exactly the form's own.
 */

export interface SettingsNavGroup<T extends string> {
  label: string;
  items: readonly T[];
}

interface PageSection {
  key: string;
  number: string;
  title: string;
  badgeClass: string;
  element: HTMLElement;
}

export type SettingsSaveState = 'idle' | 'saving' | 'error';

interface SettingsSidePanelProps<T extends string> {
  groups: readonly SettingsNavGroup<T>[];
  visibleItems: readonly T[];
  active: T;
  icons: Record<T, LucideIcon>;
  onSelect: (item: T) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  /** id of the open section's <form>; null = this section has no page-wide Save. */
  saveFormId: string | null;
  dirty: boolean;
  saveState: SettingsSaveState;
  onSaveClick: () => void;
}

/** Numbered section headers inside the content: a round badge holding a number, next to an <h3>. */
function readPageSections(root: HTMLElement): PageSection[] {
  const sections: PageSection[] = [];
  root.querySelectorAll('h3').forEach((heading, index) => {
    const row = heading.parentElement;
    const badge = row?.querySelector<HTMLElement>(':scope > .rounded-full');
    const number = badge?.textContent?.trim() ?? '';
    if (!badge || !/^\d+$/.test(number)) return;
    const element = row?.parentElement?.parentElement ?? heading;
    sections.push({
      key: `${number}-${index}`,
      number,
      title: heading.textContent?.trim() ?? '',
      badgeClass: badge.className,
      element,
    });
  });
  return sections;
}

export function SettingsSidePanel<T extends string>({
  groups,
  visibleItems,
  active,
  icons,
  onSelect,
  contentRef,
  saveFormId,
  dirty,
  saveState,
  onSaveClick,
}: SettingsSidePanelProps<T>) {
  const [sections, setSections] = useState<PageSection[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  // Re-read the numbered parts whenever the open section's content changes.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSections(readPageSections(root)));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentRef, active]);

  // Highlight the part being read. Scroll events do not bubble, so listen in the capture phase (the page scrolls
  // inside the app's scroll region on small screens and in the window on large ones).
  useEffect(() => {
    if (sections.length === 0) return;
    const update = () => {
      let next = sections[0]?.key ?? null;
      for (const section of sections) {
        if (section.element.getBoundingClientRect().top < 160) next = section.key;
      }
      setCurrent(next);
    };
    update();
    document.addEventListener('scroll', update, true);
    return () => document.removeEventListener('scroll', update, true);
  }, [sections]);

  const statusText =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'error'
        ? "Couldn't save. Check the highlighted fields."
        : dirty
          ? 'Unsaved changes'
          : 'All changes saved';

  return (
    <aside
      aria-label="Settings panel"
      className="sticky top-4 w-[236px] shrink-0 self-start border-l border-border pl-5 max-h-[calc(100vh-2rem)] overflow-y-auto"
    >
      <nav aria-label="Settings sections" className="flex flex-col">
        {groups.map((group) => {
          const items = group.items.filter((item) => visibleItems.includes(item));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="mb-0.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const Icon: LucideIcon = icons[item];
                  const isActive = active === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onSelect(item)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-left text-sm transition-colors cursor-pointer flex items-center gap-2',
                        isActive
                          ? 'bg-emerald-50/80 font-bold text-emerald-900 border-l-2 border-emerald-800 pl-2.5 shadow-xs'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground font-medium'
                      )}
                    >
                      <Icon
                        className={cn('size-3.5 shrink-0', isActive ? 'text-emerald-800' : 'text-muted-foreground')}
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {sections.length > 1 && (
        <nav aria-label="On this page" className="mt-2.5 border-t border-dashed border-border pt-2.5">
          <p className="mb-0.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">On this page</p>
          <div className="flex flex-col gap-0.5">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => section.element.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                aria-current={current === section.key ? 'location' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1 text-left text-xs transition-colors cursor-pointer',
                  current === section.key
                    ? 'bg-accent/60 font-bold text-foreground'
                    : 'font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <span className={cn(section.badgeClass, 'size-4.5 text-[10px]')} aria-hidden="true">
                  {section.number}
                </span>
                <span className="min-w-0 truncate capitalize" title={section.title}>{section.title.toLowerCase()}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {saveFormId && (
        <div className="mt-3 rounded-xl border border-border bg-card p-2.5 shadow-xs">
          <p
            role="status"
            className={cn(
              'mb-1.5 flex items-center gap-1.5 text-xs font-medium',
              saveState === 'error' ? 'text-destructive' : dirty ? 'text-amber-800' : 'text-muted-foreground'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                saveState === 'error' ? 'bg-destructive' : dirty ? 'bg-amber-500' : 'bg-emerald-600'
              )}
            />
            {statusText}
          </p>
          <button
            type="submit"
            form={saveFormId}
            onClick={onSaveClick}
            disabled={saveState === 'saving'}
            className="w-full rounded-lg bg-emerald-800 px-4 py-2 h-9 text-sm font-bold text-white transition-all hover:bg-emerald-900 disabled:opacity-50 shadow-xs hover:shadow-sm cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Check className="size-4 shrink-0" aria-hidden="true" />
            <span>{saveState === 'saving' ? 'Saving...' : 'Save changes'}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
