'use client';

import { useRef, useState } from 'react';

/**
 * Copy-to-clipboard feedback for the admin console. The checkmark (copiedKey) appears only after the browser
 * confirms the write; if the clipboard is blocked (permission denied, insecure context), failedKey is set instead
 * so the control can say so, and the text stays on screen for manual selection.
 */
export function useCopyFeedback() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (key: string, ok: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    setCopiedKey(ok ? key : null);
    setFailedKey(ok ? null : key);
    timer.current = setTimeout(() => {
      setCopiedKey(null);
      setFailedKey(null);
    }, ok ? 2000 : 4000);
  };

  const handleCopy = (text: string, key: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      show(key, false);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => show(key, true),
      () => show(key, false),
    );
  };

  return { copiedKey, failedKey, handleCopy };
}
