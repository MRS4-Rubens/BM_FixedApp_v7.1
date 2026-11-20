'use client';

import { useEffect } from 'react';

interface ScrollLock {
  count: number;
  styles: Array<{ property: string; value: string; priority: string }>;
}

const locks = new WeakMap<HTMLElement, ScrollLock>();

/** Lock document and authenticated page scrolling, preserving nested locks and prior inline styles. */
export function usePageScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const targets = new Set([
      document.documentElement,
      document.body,
      ...document.querySelectorAll<HTMLElement>('[data-app-scroll-region]'),
    ]);

    for (const target of targets) {
      const current = locks.get(target);
      if (current) {
        current.count += 1;
      } else {
        locks.set(target, {
          count: 1,
          styles: ['overflow-x', 'overflow-y'].map((property) => ({
            property,
            value: target.style.getPropertyValue(property),
            priority: target.style.getPropertyPriority(property),
          })),
        });
        target.style.setProperty('overflow', 'hidden');
      }
    }

    return () => {
      for (const target of targets) {
        const current = locks.get(target);
        if (!current || --current.count > 0) continue;
        target.style.removeProperty('overflow');
        for (const { property, value, priority } of current.styles) {
          if (value) target.style.setProperty(property, value, priority);
        }
        locks.delete(target);
      }
    };
  }, [active]);
}
