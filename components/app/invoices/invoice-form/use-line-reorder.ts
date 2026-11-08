'use client';

import { useState } from 'react';
import type { UseFormSetValue, UseFormGetValues } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { taxRates as taxRatesTable } from '@/lib/db/schema';

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

  const handleMoveLine = (from: number, to: number, direction: 'up' | 'down') => {
    if (to < 0 || to >= fieldsLength) return;
    move(from, to);
    const targetLineNum = to + 1;
    requestAnimationFrame(() => {
      let el = document.getElementById(`move-line-${direction}-${targetLineNum}`) as HTMLButtonElement | null;
      if (!el || el.disabled) {
        const altDirection = direction === 'up' ? 'down' : 'up';
        el = document.getElementById(`move-line-${altDirection}-${targetLineNum}`) as HTMLButtonElement | null;
      }
      el?.focus();
    });
  };

  const handleTouchStart = (e: React.TouchEvent, idx: number) => {
    if (fieldsLength <= 1) return;
    onBeforeDrag?.();
    setDraggedIdx(idx);
    setTouchDraggingIdx(idx);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (draggedIdx === null) return;
    const touch = e.touches[0];
    if (!touch) return;

    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetTr = el?.closest('tbody tr[data-row-index]') as HTMLElement | null;
    if (!targetTr) {
      if (dropTargetIdx !== null) {
        setDropTargetIdx(null);
        setDropPosition(null);
      }
      return;
    }

    const rawIdx = targetTr.getAttribute('data-row-index');
    if (rawIdx === null) return;
    const targetIdx = parseInt(rawIdx, 10);

    if (targetIdx === draggedIdx) {
      if (dropTargetIdx !== null) {
        setDropTargetIdx(null);
        setDropPosition(null);
      }
      return;
    }

    const rect = targetTr.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: 'top' | 'bottom' = touch.clientY < midY ? 'top' : 'bottom';

    if (dropTargetIdx !== targetIdx || dropPosition !== position) {
      setDropTargetIdx(targetIdx);
      setDropPosition(position);
    }
  };

  const handleTouchEnd = () => {
    if (draggedIdx !== null && dropTargetIdx !== null && dropPosition !== null) {
      const from = draggedIdx;
      let to = dropTargetIdx;
      if (from < dropTargetIdx) {
        to = dropPosition === 'top' ? dropTargetIdx - 1 : dropTargetIdx;
      } else if (from > dropTargetIdx) {
        to = dropPosition === 'top' ? dropTargetIdx : dropTargetIdx + 1;
      }

      to = Math.max(0, Math.min(fieldsLength - 1, to));

      if (from !== to) {
        move(from, to);
      }
    }

    setDraggedIdx(null);
    setDropTargetIdx(null);
    setDropPosition(null);
    setTouchDraggingIdx(null);
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

