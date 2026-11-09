'use client'

import { useSyncExternalStore } from 'react'

export const TABLET_PORTRAIT_MEDIA = '(min-width: 768px) and (max-width: 1023px)'

export function subscribeTabletMedia(callback: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mql = window.matchMedia(TABLET_PORTRAIT_MEDIA)
  mql.addEventListener('change', callback)
  return () => {
    mql.removeEventListener('change', callback)
  }
}

export function getTabletSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(TABLET_PORTRAIT_MEDIA).matches
}

export function getTabletServerSnapshot(): boolean {
  return false
}

export function useTabletPortrait(): boolean {
  return useSyncExternalStore(
    subscribeTabletMedia,
    getTabletSnapshot,
    getTabletServerSnapshot,
  )
}

