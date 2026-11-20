'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SUGGESTION_LIST_MIN_HEIGHT } from './use-product-suggestions';
import { useFormContext, useWatch } from 'react-hook-form';
import { ChevronDown, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UNIT_OF_MEASUREMENT_OPTIONS } from '@/lib/gst/units';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { ProductOption } from '@/lib/pickers/types';
import type { taxRates as taxRatesTable } from '@/lib/db/schema';
import type { resolveDraftDisplayPrefs } from '@/lib/invoices/display-prefs';
type ResolvedDraftDisplayPrefs = ReturnType<typeof resolveDraftDisplayPrefs>;
import { colStyles } from './col-styles';
import { fitsQuantityDecimals, quantityFormatMessage, quantityInputGuards } from '@/lib/invoices/quantity-format';
import { LINE_REORDER_HINT_ID, lineReorderHandleId, reorderTargetForKey } from './use-line-reorder';

const REORDER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End']);

const tableInputCls = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring hover:border-muted-foreground/20 shadow-sm transition-all";

export function LineItemRow({
  fieldId,
  idx,
  fieldsLength,
  taxRates,
  sortedTaxRates,
  gstRateTypeVal,
  displayPrefs,
  mounted,
  remove,
  handleMoveLine,
  draggedIdx,
  dropTargetIdx,
  dropPosition,
  touchDraggingIdx,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  suggestIdx,
  isProdSuggestionsOpen,
  setIsProdSuggestionsOpen,
  activeInputRect,
  updateInputRect,
  productOptions,
  handleSelectProduct,
  handleDescChange,
  handleDescFocus,
}: {
  fieldId: string;
  idx: number;
  fieldsLength: number;
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  sortedTaxRates: Array<typeof taxRatesTable.$inferSelect>;
  gstRateTypeVal: 'exclusive' | 'inclusive';
  displayPrefs: ResolvedDraftDisplayPrefs;
  mounted: boolean;
  remove: (index: number) => void;
  handleMoveLine: (from: number, to: number) => void;
  draggedIdx: number | null;
  dropTargetIdx: number | null;
  dropPosition: 'top' | 'bottom' | null;
  touchDraggingIdx: number | null;
  handleDragStart: (e: React.DragEvent, idx: number) => void;
  handleDragOver: (e: React.DragEvent, idx: number) => void;
  handleDragLeave: (e: React.DragEvent, idx: number) => void;
  handleDrop: (e: React.DragEvent, targetIdx: number) => void;
  handleDragEnd: () => void;
  handleTouchStart: (e: React.TouchEvent, idx: number) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
  suggestIdx: number | null;
  isProdSuggestionsOpen: boolean;
  setIsProdSuggestionsOpen: (open: boolean) => void;
  activeInputRect: { top: number; left: number; width: number; height: number; maxHeight?: number } | null;
  updateInputRect: (el: HTMLInputElement | null) => void;
  productOptions: ProductOption[];
  handleSelectProduct: (idx: number, prod: ProductOption) => void;
  handleDescChange: (idx: number, val: string) => void;
  handleDescFocus: (idx: number, el: HTMLInputElement) => void;
}) {
  const { register, control, setValue, formState: { errors } } = useFormContext<InvoiceDraftInput>();

  const [qtyVal, rateVal, discVal, trIdVal, descVal] = useWatch({
    control,
    name: [
      `line_items.${idx}.quantity`,
      `line_items.${idx}.unit_price`,
      `line_items.${idx}.discount`,
      `line_items.${idx}.tax_rate_id`,
      `line_items.${idx}.description`,
    ] as const,
  });

  const qty = Number(qtyVal) || 0;
  const rate = Number(rateVal) || 0;
  const disc = Number(discVal) || 0;
  const trId = trIdVal;
  const trPct = Number(taxRates.find((tr) => tr.id === trId)?.rate_percentage || 0);

  const lineGross = rate * qty;
  const discountAmount = lineGross * (disc / 100);
  const currentNetAmt = gstRateTypeVal === 'inclusive'
    ? (lineGross - discountAmount)
    : (lineGross - discountAmount) * (1 + trPct / 100);

  const [netAmtInputVal, setNetAmtInputVal] = useState<string | null>(null);

  const displayNetAmt = netAmtInputVal !== null
    ? netAmtInputVal
    : (currentNetAmt > 0 ? currentNetAmt.toFixed(2) : '0.00');

  const onNetAmtChange = (valStr: string) => {
    setNetAmtInputVal(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val >= 0 && qty > 0) {
      const discountFactor = 1 - (disc / 100);
      if (discountFactor > 0) {
        let calculatedRate = 0;
        if (gstRateTypeVal === 'inclusive') {
          calculatedRate = val / (qty * discountFactor);
        } else {
          const amtBeforeGst = val / (1 + trPct / 100);
          calculatedRate = amtBeforeGst / (qty * discountFactor);
        }
        setValue(`line_items.${idx}.unit_price`, parseFloat(calculatedRate.toFixed(2)));
      }
    }
  };

  const onNetAmtBlur = () => {
    setNetAmtInputVal(null);
  };

  const rowDescVal = descVal || '';
  // Quantity Format (Invoice Settings): whole-unit arrows, blocked keys, and an amber box for a value an older draft
  // saved with more decimals than now allowed (finalize rejects it with the same message).
  const qtyGuards = quantityInputGuards(displayPrefs.quantityDecimals);
  const qtyField = register(`line_items.${idx}.quantity`);
  const qtyFits = fitsQuantityDecimals(String(qtyVal ?? ''), displayPrefs.quantityDecimals);
  const canReorder = fieldsLength > 1;
  const isDragging = draggedIdx === idx;
  const isDropTop = dropTargetIdx === idx && dropPosition === 'top' && draggedIdx !== idx;
  const isDropBottom = dropTargetIdx === idx && dropPosition === 'bottom' && draggedIdx !== idx;

  return (
    <tr
      key={fieldId}
      data-row-index={idx}
      onDragOver={(e) => handleDragOver(e, idx)}
      onDragLeave={(e) => handleDragLeave(e, idx)}
      onDrop={(e) => handleDrop(e, idx)}
      className={cn(
        "group transition-colors relative",
        (isDragging || touchDraggingIdx === idx) && "opacity-60 bg-muted/40 select-none",
        (!isDragging && touchDraggingIdx !== idx) && "hover:bg-muted/5",
        isDropTop && "bg-slate-200/75 dark:bg-slate-800/80 [box-shadow:inset_0_3px_0_0_#334155] dark:[box-shadow:inset_0_3px_0_0_#94a3b8]",
        isDropBottom && "bg-slate-200/75 dark:bg-slate-800/80 [box-shadow:inset_0_-3px_0_0_#334155] dark:[box-shadow:inset_0_-3px_0_0_#94a3b8]"
      )}
    >
      {/* Grip handle: the ONE reorder control. Mouse/finger drag it, or focus it (Tab) and press ↑ ↓ Home End.
          A div with role="button" (not <button>) because Firefox won't start a native drag from a <button>. */}
      <td className="pl-1 pr-0 py-1.5 align-middle" style={colStyles.drag}>
        <div
          id={lineReorderHandleId(idx)}
          role="button"
          tabIndex={canReorder ? 0 : -1}
          aria-disabled={!canReorder}
          aria-label={`Reorder line ${idx + 1}${rowDescVal.trim() ? `, ${rowDescVal.trim()}` : ''}`}
          aria-describedby={canReorder ? LINE_REORDER_HINT_ID : undefined}
          draggable={canReorder}
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragEnd={handleDragEnd}
          onKeyDown={(e) => {
            if (!canReorder || !REORDER_KEYS.has(e.key)) return;
            // Swallow reorder keys even at the first/last row, so ↑ ↓ Home End never scroll the page instead.
            e.preventDefault();
            const to = reorderTargetForKey(e.key, idx, fieldsLength);
            if (to !== null) handleMoveLine(idx, to);
          }}
          onTouchStart={(e) => handleTouchStart(e, idx)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className={cn(
            // 32×36px hit area (easy to grab with a finger) around a small icon.
            "flex h-9 w-8 items-center justify-center rounded-md transition-all select-none touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            canReorder
              ? "cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95"
              : "opacity-20 cursor-default",
            touchDraggingIdx === idx && "bg-indigo-500/20 text-indigo-600 scale-110 shadow-xs"
          )}
          title={canReorder ? 'Drag to reorder · or focus and use ↑ ↓ keys' : undefined}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </div>
      </td>

      {/* S.No */}
      <td className="pl-3 pr-2 py-1.5 text-xs font-mono text-muted-foreground text-left" style={colStyles.sNo}>
        {String(idx + 1).padStart(3, '0')}
      </td>

      {/* Description with autocomplete */}
      <td className="px-2 py-1.5 relative" style={colStyles.description}>
        <input
          type="text"
          placeholder="Description"
          aria-label={`Description, line ${idx + 1}`}
          className={cn(tableInputCls, errors.line_items?.[idx]?.description && 'border-destructive focus:ring-destructive/30 animate-shake')}
          style={colStyles.description}
          {...register(`line_items.${idx}.description`)}
          onChange={(e) => {
            handleDescChange(idx, e.target.value);
            updateInputRect(e.target);
          }}
          onFocus={(e) => {
            handleDescFocus(idx, e.target);
          }}
          onBlur={() => {
            setTimeout(() => {
              setIsProdSuggestionsOpen(false);
              updateInputRect(null);
            }, 200);
          }}
        />
        {mounted && isProdSuggestionsOpen && suggestIdx === idx && rowDescVal.trim().length > 0 && productOptions.length > 0 && activeInputRect && (activeInputRect.maxHeight ?? SUGGESTION_LIST_MIN_HEIGHT) >= SUGGESTION_LIST_MIN_HEIGHT && (
          createPortal(
            <div
              style={{
                position: 'absolute',
                top: activeInputRect.top + 4,
                left: activeInputRect.left,
                width: activeInputRect.width,
                maxHeight: activeInputRect.maxHeight,
                zIndex: 9999,
              }}
              className="max-h-48 overflow-y-auto rounded-lg border border-border bg-popover py-1.5 shadow-lg animate-fadeIn text-popover-foreground"
            >
              {productOptions.map(prod => (
                <button
                  key={prod.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectProduct(idx, prod)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent hover:text-accent-foreground transition-colors font-medium flex justify-between items-center border-b border-border/40 last:border-b-0 cursor-pointer"
                >
                  <span>{prod.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded animate-fadeIn">
                    {prod.hsn_sac_code || 'N/A'} | ₹{(prod.default_sale_price_paise / 100).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        )}
      </td>

      {/* HSN/SAC */}
      {displayPrefs.showHsn && (
        <td className="px-2 py-1.5" style={colStyles.hsn}>
          <input
            type="text"
            placeholder="HSN"
            aria-label={`HSN or SAC, line ${idx + 1}`}
            className={cn(tableInputCls, 'font-mono text-center', errors.line_items?.[idx]?.hsn_sac_code && 'border-destructive focus:ring-destructive/30 animate-shake')}
            style={colStyles.hsn}
            {...register(`line_items.${idx}.hsn_sac_code`)}
          />
        </td>
      )}

      {/* Qty */}
      <td className="px-2 py-1.5" style={colStyles.qty}>
        <input
          type="number"
          min={qtyGuards.min}
          step={qtyGuards.step}
          inputMode={qtyGuards.inputMode}
          onKeyDown={qtyGuards.onKeyDown}
          aria-label={`Quantity, line ${idx + 1}`}
          title={qtyFits ? undefined : quantityFormatMessage(displayPrefs.quantityDecimals)}
          className={cn(tableInputCls, 'text-center font-semibold', !qtyFits && 'border-amber-500 ring-1 ring-amber-500/40', errors.line_items?.[idx]?.quantity && 'border-destructive focus:ring-destructive/30 animate-shake')}
          style={colStyles.qty}
          {...qtyField}
          onChange={(e) => { qtyGuards.clean(e.target); return qtyField.onChange(e); }}
        />
      </td>

      {/* UQC */}
      <td className="px-2 py-1.5" style={colStyles.uqc}>
        <div className="relative" style={colStyles.uqc}>
          <select
            aria-label={`Unit, line ${idx + 1}`}
            className="w-full appearance-none rounded-md border border-border bg-background pl-2.5 pr-6 py-1 text-sm font-medium text-foreground text-center focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer hover:border-muted-foreground/20 shadow-sm transition-all"
            style={colStyles.uqc}
            {...register(`line_items.${idx}.unit_of_measurement`)}
          >
            {UNIT_OF_MEASUREMENT_OPTIONS.map((uqc) => (
              <option key={uqc} value={uqc}>
                {uqc}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none size-3 text-muted-foreground" />
        </div>
      </td>

      {/* Rate */}
      <td className="px-2 py-1.5" style={colStyles.rate}>
        <input
          type="number"
          min="0"
          step="0.01"
          aria-label={`Rate, line ${idx + 1}`}
          className={cn(tableInputCls, 'text-right', errors.line_items?.[idx]?.unit_price && 'border-destructive focus:ring-destructive/30 animate-shake')}
          style={colStyles.rate}
          {...register(`line_items.${idx}.unit_price`)}
        />
      </td>

      {/* Disc */}
      {displayPrefs.discEnabled && (
        <td className="px-2 py-1.5" style={colStyles.disc}>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            aria-label={`Discount percent, line ${idx + 1}`}
            className={cn(tableInputCls, 'text-right', errors.line_items?.[idx]?.discount && 'border-destructive focus:ring-destructive/30 animate-shake')}
            style={colStyles.disc}
            {...register(`line_items.${idx}.discount`)}
          />
        </td>
      )}

      {/* GST Rate */}
      <td className="px-2 py-1.5" style={colStyles.gst}>
        <div className="relative" style={colStyles.gst}>
          <select
            aria-label={`Tax rate, line ${idx + 1}`}
            className={cn("w-full appearance-none rounded-md border border-border bg-background pl-2.5 pr-6 py-1 text-xs text-foreground text-center focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer hover:border-muted-foreground/20 shadow-sm transition-all", errors.line_items?.[idx]?.tax_rate_id && 'border-destructive focus:ring-destructive/30 animate-shake')}
            style={colStyles.gst}
            title={taxRates.find(tr => tr.id === trId)?.label || 'Select GST Rate'}
            {...register(`line_items.${idx}.tax_rate_id`)}
          >
            <option value="" disabled>SELECT</option>
            {sortedTaxRates.map(tr => (
              <option key={tr.id} value={tr.id} title={tr.label}>
                {Number(tr.rate_percentage)}%
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none size-3 text-muted-foreground" />
        </div>
      </td>

      {/* NET Amount */}
      <td className="px-2 py-1.5" style={colStyles.netAmt}>
        <input
          type="number"
          min="0"
          step="0.01"
          aria-label={`Net amount, line ${idx + 1}`}
          className={cn(tableInputCls, 'text-right font-semibold text-primary focus:ring-primary/20')}
          style={colStyles.netAmt}
          value={displayNetAmt}
          onChange={(e) => onNetAmtChange(e.target.value)}
          onBlur={onNetAmtBlur}
        />
      </td>

      {/* Action */}
      <td className="px-2 py-1.5 text-center" style={colStyles.action}>
        {fieldsLength > 1 && (
          <button
            type="button"
            onClick={() => remove(idx)}
            aria-label={`Remove line item ${idx + 1}`}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 shadow-sm md:opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}
