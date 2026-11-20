'use client';

import { ArrowUpDown, ListTodo, Plus } from 'lucide-react';
import { colStyles } from './col-styles';
import { LineItemRow } from './line-item-row';
import { LINE_REORDER_HINT_ID, LINE_REORDER_STATUS_ID } from './use-line-reorder';
import type { UseFieldArrayReturn } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { ProductOption } from '@/lib/pickers/types';
import type { taxRates as taxRatesTable } from '@/lib/db/schema';
import type { resolveDraftDisplayPrefs } from '@/lib/invoices/display-prefs';
type ResolvedDraftDisplayPrefs = ReturnType<typeof resolveDraftDisplayPrefs>;

export function LineItemsTable({
  fields,
  append,
  remove,
  handleMoveLine,
  handleGroupByGst,
  taxRates,
  sortedTaxRates,
  gstRateTypeVal,
  displayPrefs,
  mounted,
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
  fields: UseFieldArrayReturn<InvoiceDraftInput, 'line_items'>['fields'];
  append: UseFieldArrayReturn<InvoiceDraftInput, 'line_items'>['append'];
  remove: UseFieldArrayReturn<InvoiceDraftInput, 'line_items'>['remove'];
  handleMoveLine: (from: number, to: number) => void;
  handleGroupByGst: () => void;
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  sortedTaxRates: Array<typeof taxRatesTable.$inferSelect>;
  gstRateTypeVal: 'exclusive' | 'inclusive';
  displayPrefs: ResolvedDraftDisplayPrefs;
  mounted: boolean;
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
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
      <div className="mb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <ListTodo className="size-4 text-primary" />
          <span className="text-sm font-bold text-foreground uppercase tracking-wider">Invoice Line Items</span>
          {fields.length > 1 && (
            <button
              type="button"
              onClick={handleGroupByGst}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary bg-muted/60 hover:bg-muted px-2 py-0.5 rounded-md border border-border/60 transition-colors ml-1 cursor-pointer"
              title="Automatically sort and group items by GST tax bracket (18%, 12%, 5%, 0%)"
            >
              <ArrowUpDown className="size-3" />
              <span>Group by GST</span>
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">GST is calculated automatically in the estimate below</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <th className="pl-1 pr-0 py-1.5" style={colStyles.drag} aria-label="Reorder"></th>
              <th className="pl-3 pr-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left whitespace-nowrap" style={colStyles.sNo}>S.No</th>
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-left whitespace-nowrap" style={colStyles.description}>Description</th>
              {displayPrefs.showHsn && <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.hsn}>HSN/SAC</th>}
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.qty}>Qty</th>
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.uqc}>UQC</th>
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center select-none whitespace-nowrap" style={colStyles.rate}>
                <div
                  className="flex items-center justify-end gap-1 cursor-help whitespace-nowrap"
                  title={gstRateTypeVal === 'inclusive'
                    ? "Prices entered are inclusive of GST. Tax will be extracted from this rate during calculations."
                    : "Prices entered are exclusive of GST. Tax will be added on top of this rate during calculations."
                  }
                >
                  <span className="whitespace-nowrap">Rate ({gstRateTypeVal === 'inclusive' ? 'GST Incl' : 'GST Excl'})</span>
                  <span className="text-xs text-muted-foreground font-bold font-sans flex items-center justify-center border border-muted-foreground/30 rounded-full size-3.5 select-none transition-colors hover:border-primary hover:text-primary">i</span>
                </div>
              </th>
              {displayPrefs.discEnabled && <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.disc}>Disc (%)</th>}
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.gst}>GST Rate</th>
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.netAmt}>Net Amount</th>
              <th className="px-2 py-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap" style={colStyles.action}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {fields.map((field, idx) => (
              <LineItemRow
                key={field.id}
                fieldId={field.id}
                idx={idx}
                fieldsLength={fields.length}
                taxRates={taxRates}
                sortedTaxRates={sortedTaxRates}
                gstRateTypeVal={gstRateTypeVal}
                displayPrefs={displayPrefs}
                mounted={mounted}
                remove={remove}
                handleMoveLine={handleMoveLine}
                draggedIdx={draggedIdx}
                dropTargetIdx={dropTargetIdx}
                dropPosition={dropPosition}
                touchDraggingIdx={touchDraggingIdx}
                handleDragStart={handleDragStart}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                handleDragEnd={handleDragEnd}
                handleTouchStart={handleTouchStart}
                handleTouchMove={handleTouchMove}
                handleTouchEnd={handleTouchEnd}
                suggestIdx={suggestIdx}
                isProdSuggestionsOpen={isProdSuggestionsOpen}
                setIsProdSuggestionsOpen={setIsProdSuggestionsOpen}
                activeInputRect={activeInputRect}
                updateInputRect={updateInputRect}
                productOptions={productOptions}
                handleSelectProduct={handleSelectProduct}
                handleDescChange={handleDescChange}
                handleDescFocus={handleDescFocus}
              />
            ))}
          </tbody>
        </table>
        {/* Screen-reader only: how the grip handles work, and a polite announcement after each move. */}
        <p id={LINE_REORDER_HINT_ID} className="sr-only">
          Drag to reorder, or press the up or down arrow key to move this line. Home and End move it to the top or bottom.
        </p>
        <p id={LINE_REORDER_STATUS_ID} role="status" aria-live="polite" className="sr-only" />
      </div>
      <button
        type="button"
        onClick={() => append({ product_id: '', description: '', hsn_sac_code: '', quantity: 1, unit_of_measurement: 'NOS', unit_price: 0, discount: 0, tax_rate_id: '' })}
        className="mt-2.5 flex items-center gap-1.5 text-sm font-bold text-primary transition-all hover:text-primary/80 hover:translate-x-0.5 whitespace-nowrap cursor-pointer"
      >
        <Plus className="size-4" /> Add Item Row
      </button>
    </div>
  );
}
