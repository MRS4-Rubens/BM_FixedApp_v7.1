'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Fit an invoice / credit-note "paper" to the width of its box (mobile plan step 2).
 *
 * The paper is designed at a fixed width (A4 ≈ 790px, A5 ≈ 700px). When the box is narrower (phones, small tablets),
 * the paper is shrunk with CSS `zoom` so the whole page is visible at once, like a PDF viewer; pinch-zoom still works
 * for detail. `zoom` (unlike transform: scale) also shrinks the layout box, so no empty space is left behind.
 * The scale is passed as a CSS variable and applied by `PAPER_FIT_CLASS`, which resets it for print, so printing
 * always uses the real size. From 1280px (desktop) it is not applied at all, so desktop is unchanged.
 */
export const PAPER_FIT_CLASS = 'max-xl:[zoom:var(--paper-fit,1)] print:[zoom:1]';

export function useFitPaper(paperWidth: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Layout effect: measure before the first paint, so the paper never flashes at full size and then shrinks.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const update = (width: number) => {
      // Two decimals keep re-renders rare while resizing; never enlarge beyond the real size.
      const next = Math.min(1, Math.floor((width / paperWidth) * 100) / 100);
      setScale((current) => (current === next ? current : next));
    };
    update(box.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [paperWidth]);

  const paperStyle = { '--paper-fit': String(scale) } as CSSProperties;
  return { boxRef, paperStyle };
}
