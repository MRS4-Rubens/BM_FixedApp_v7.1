'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  applyDesktopView,
  canOfferDesktopView,
  DESKTOP_VIEW_CHANGE_EVENT,
  DESKTOP_VIEW_STORAGE_KEY,
  isDesktopViewEnabled,
  setDesktopView,
} from '@/lib/desktop-view';

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DESKTOP_VIEW_STORAGE_KEY) {
      applyDesktopView(isDesktopViewEnabled());
      callback();
    }
  };
  window.addEventListener(DESKTOP_VIEW_CHANGE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(DESKTOP_VIEW_CHANGE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

/** [offered on this device, currently on]; [false, false] on the server. */
function useDesktopView(): readonly [boolean, boolean] {
  const offered = useSyncExternalStore(subscribe, canOfferDesktopView, () => false);
  const enabled = useSyncExternalStore(subscribe, isDesktopViewEnabled, () => false);
  return [offered, offered && enabled] as const;
}

/** Re-applies a saved "Desktop view" choice after each page load (render it once per authenticated layout). */
export function DesktopViewSync() {
  useEffect(() => {
    if (canOfferDesktopView() && isDesktopViewEnabled()) applyDesktopView(true);
  }, []);
  return null;
}

/** The on/off row shown in the phone menu and the account menu; renders nothing on tablets and computers. */
export function DesktopViewToggle({ className, onToggled }: { className?: string; onToggled?: () => void }) {
  const [offered, enabled] = useDesktopView();
  if (!offered) return null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => {
        setDesktopView(!enabled);
        onToggled?.();
      }}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-foreground/80 transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <Monitor className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block">Desktop view</span>
        <span className="block text-[10px] font-medium text-muted-foreground">Show the full desktop layout on this phone</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
          enabled ? 'bg-indigo-600' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow-xs transition-transform',
            enabled ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
