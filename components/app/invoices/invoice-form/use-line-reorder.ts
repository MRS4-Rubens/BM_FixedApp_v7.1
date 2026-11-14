'use client';

import { useEffect, useRef, useState } from 'react';
import type { UseFormSetValue, UseFormGetValues } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { taxRates as taxRatesTable } from '@/lib/db/schema';

/** id of the polite live region (rendered once by LineItemsTable) that announces row moves. */
export const LINE_REORDER_STATUS_ID = 'line-reorder-status';

/** id of the hidden hint every grip handle points to with aria-describedby. */
export const LINE_REORDER_HINT_ID = 'line-reorder-hint';

/** id of a row's grip handle, so focus can follow a row after a keyboard move. */
export function lineReorderHandleId(idx: number): string {
  return `reorder-line-${idx + 1}`;
}

/** Keyboard keys on the grip handle → target position, or null when the key isn't a reorder key. */
export function reorderTargetForKey(key: string, idx: number, count: number): number | null {
  const to =
    key === 'ArrowUp' ? idx - 1 : key === 'ArrowDown' ? idx + 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
  if (to === null || to < 0 || to >= count || to === idx) return null;
  return to;
}

function announceLineReorder(message: string) {
  const region = document.getElementById(LINE_REORDER_STATUS_ID);
  if (!region) return;
  // Clear first so the same text twice in a row is still read out.
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

const AUTO_SCROLL_EDGE = 72; // px from the top/bottom of the visible list where auto-scroll starts
const AUTO_SCROLL_MAX_SPEED = 14; // px per frame at the very edge

function findScrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The part of the scroll container that is actually on screen. */
function visibleBox(scroller: HTMLElement): { top: number; bottom: number } {
  if (scroller === document.scrollingElement || scroller === document.documentElement) {
    return { top: 0, bottom: window.innerHeight };
  }
  const rect = scroller.getBoundingClientRect();
  return { top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom) };
}

export function useLineReorder({
  fieldsLength,
  move,
  setValue,
  getValues,
  taxRates,
  onBeforeDrag,
}: {
  fieldsLength: number;
  move: (from: number, to: number) => void;
  setValue: UseFormSetValue<InvoiceDraftInput>;
  getValues: UseFormGetValues<InvoiceDraftInput>;
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  onBeforeDrag?: () => void;
}) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<'top' | 'bottom' | null>(null);
  const [touchDraggingIdx, setTouchDraggingIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    onBeforeDrag?.();
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));

    const tr = (e.currentTarget as HTMLElement).closest('tr');
    if (tr && e.dataTransfer.setDragImage) {
      const rect = tr.getBoundingClientRect();
      e.dataTransfer.setDragImage(tr, e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIdx === null || draggedIdx === idx) {
      if (dropTargetIdx !== null) {
        setDropTargetIdx(null);
        setDropPosition(null);
      }
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'top' : 'bottom';

    if (dropTargetIdx !== idx || dropPosition !== position) {
      setDropTargetIdx(idx);
      setDropPosition(position);
    }
  };

  const handleDragLeave = (e: React.DragEvent, idx: number) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dropTargetIdx === idx) {
      setDropTargetIdx(null);
      setDropPosition(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null);
      setDropTargetIdx(null);
      setDropPosition(null);
      return;
    }

    const from = draggedIdx;
    let to = targetIdx;
    if (from < targetIdx) {
      to = dropPosition === 'top' ? targetIdx - 1 : targetIdx;
    } else if (from > targetIdx) {
      to = dropPosition === 'top' ? targetIdx : targetIdx + 1;
    }

    to = Math.max(0, Math.min(fieldsLength - 1, to));

    if (from !== to) {
      move(from, to);
      announceMove(to);
    }

    setDraggedIdx(null);
    setDropTargetIdx(null);
    setDropPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDropTargetIdx(null);
    setDropPosition(null);
  };

  // Tells screen-reader users what just happened (polite live region rendered by LineItemsTable).
  const announceMove = (to: number) => {
    const desc = String(getValues(`line_items.${to}.description`) ?? '').trim();
    announceLineReorder(`${desc ? `"${desc}"` : 'Line'} moved to position ${to + 1} of ${fieldsLength}.`);
  };

  /** Keyboard reorder from the grip handle (↑ ↓ Home End). Focus follows the moved row so keys can repeat. */
  const handleMoveLine = (from: number, to: number) => {
    if (to < 0 || to >= fieldsLength || to === from) return;
    move(from, to);
    announceMove(to);
    requestAnimationFrame(() => {
      document.getElementById(lineReorderHandleId(to))?.focus();
    });
  };

  // ---- Finger (touch) drag ------------------------------------------------------------------------
  // Refs, not state, because the auto-scroll loop runs between renders and must see the latest finger position.
  const touchRef = useRef<{ idx: number; x: number; y: number; scroller: HTMLElement } | null>(null);
  const touchDropRef = useRef<{ idx: number; pos: 'top' | 'bottom' } | null>(null);
  const rafRef = useRef<number | null>(null);

  const updateTouchTarget = () => {
    const t = touchRef.current;
    if (!t) return;
    const el = document.elementFromPoint(t.x, t.y);
    const targetTr = el?.closest('tbody tr[data-row-index]') as HTMLElement | null;
    let next: { idx: number; pos: 'top' | 'bottom' } | null = null;
    if (targetTr) {
      const targetIdx = parseInt(targetTr.getAttribute('data-row-index') ?? '', 10);
      if (!Number.isNaN(targetIdx) && targetIdx !== t.idx) {
        const rect = targetTr.getBoundingClientRect();
        next = { idx: targetIdx, pos: t.y < rect.top + rect.height / 2 ? 'top' : 'bottom' };
      }
    }
    const prev = touchDropRef.current;
    if (prev?.idx !== next?.idx || prev?.pos !== next?.pos) {
      touchDropRef.current = next;
      setDropTargetIdx(next?.idx ?? null);
      setDropPosition(next?.pos ?? null);
    }
  };

  // While a finger holds a row near the top/bottom edge of the visible list, scroll it so rows far away can be reached.
  const autoScrollTick = () => {
    const t = touchRef.current;
    if (!t) {
      rafRef.current = null;
      return;
    }
    const box = visibleBox(t.scroller);
    let dy = 0;
    if (t.y < box.top + AUTO_SCROLL_EDGE) {
      dy = -Math.ceil(((box.top + AUTO_SCROLL_EDGE - t.y) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX_SPEED);
    } else if (t.y > box.bottom - AUTO_SCROLL_EDGE) {
      dy = Math.ceil(((t.y - (box.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE) * AUTO_SCROLL_MAX_SPEED);
    }
    if (dy !== 0) {
      t.scroller.scrollBy(0, dy);
      updateTouchTarget();
    }
    rafRef.current = requestAnimationFrame(autoScrollTick);
  };

  const stopTouchDrag = () => {
    touchRef.current = null;
    touchDropRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setDraggedIdx(null);
    setDropTargetIdx(null);
    setDropPosition(null);
    setTouchDraggingIdx(null);
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleTouchStart = (e: React.TouchEvent, idx: number) => {
    if (fieldsLength <= 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    onBeforeDrag?.();
    touchRef.current = { idx, x: touch.clientX, y: touch.clientY, scroller: findScrollParent(e.currentTarget as HTMLElement) };
    touchDropRef.current = null;
    setDraggedIdx(idx);
    setTouchDraggingIdx(idx);
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(autoScrollTick);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = touchRef.current;
    const touch = e.touches[0];
    if (!t || !touch) return;
    t.x = touch.clientX;
    t.y = touch.clientY;
    updateTouchTarget();
  };

  const handleTouchEnd = () => {
    const t = touchRef.current;
    const drop = touchDropRef.current;
    if (t && drop) {
      const from = t.idx;
      let to = drop.idx;
      if (from < drop.idx) {
        to = drop.pos === 'top' ? drop.idx - 1 : drop.idx;
      } else if (from > drop.idx) {
        to = drop.pos === 'top' ? drop.idx : drop.idx + 1;
      }
      to = Math.max(0, Math.min(fieldsLength - 1, to));
      if (from !== to) {
        move(from, to);
        announceMove(to);
      }
    }
    stopTouchDrag();
  };

  const handleGroupByGst = () => {
    if (fieldsLength <= 1) return;
    const currentItems = [...(getValues('line_items') || [])];
    const sorted = [...currentItems].sort((a, b) => {
      const pctA = Number(taxRates.find((tr) => tr.id === a.tax_rate_id)?.rate_percentage || 0);
      const pctB = Number(taxRates.find((tr) => tr.id === b.tax_rate_id)?.rate_percentage || 0);
      return pctB - pctA;
    });
    setValue('line_items', sorted);
  };

  return {
    draggedIdx,
    dropTargetIdx,
    dropPosition,
    touchDraggingIdx,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleMoveLine,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleGroupByGst,
  };
}

