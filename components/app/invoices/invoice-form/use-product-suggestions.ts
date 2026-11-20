'use client';

import { useState, useEffect, useRef } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import { searchProductOptions } from '@/lib/actions/products/search-product-options';
import type { ProductOption } from '@/lib/pickers/types';

/** The visible area: the visual viewport (shrinks and shifts when the phone keyboard or pinch-zoom is active),
 * falling back to the window. */
function visibleBounds() {
  const vv = window.visualViewport;
  const left = vv?.offsetLeft ?? 0;
  const top = vv?.offsetTop ?? 0;
  return { left, top, right: left + (vv?.width ?? window.innerWidth), bottom: top + (vv?.height ?? window.innerHeight) };
}

/** Suggestion box geometry. The list (max 192px tall, drawn 4px below `top`) goes under the input, kept inside the
 * visible area with an 8px margin; it moves above the input when there is clearly more room there (e.g. phone keyboard
 * open), and `maxHeight` shrinks it to the room available on the chosen side. On a roomy desktop screen this is the
 * input's own position and the list's normal height. */
const LIST_MAX_HEIGHT = 192;
const LIST_MIN_HEIGHT = 64;
const GAP = 4;
const EDGE = 8;
export interface SuggestionRect {
  top: number;
  left: number;
  width: number;
  height: number;
  maxHeight: number;
}
function suggestionRect(el: HTMLInputElement): SuggestionRect {
  const rect = el.getBoundingClientRect();
  const view = visibleBounds();
  const width = Math.min(rect.width, view.right - view.left - EDGE * 2);
  const left = Math.max(view.left + EDGE, Math.min(rect.left, view.right - width - EDGE));
  const below = view.bottom - rect.bottom - GAP - EDGE;
  const above = rect.top - view.top - GAP - EDGE;
  const flip = below < LIST_MAX_HEIGHT && above > below;
  const maxHeight = Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, flip ? above : below));
  // The consumer draws the list at top + GAP, so above the input the list ends GAP px above it.
  const top = flip ? rect.top - maxHeight - GAP * 2 : rect.bottom;
  return { top: top + window.scrollY, left: left + window.scrollX, width, height: rect.height, maxHeight };
}

export function useProductSuggestions({
  setValue,
  lineItems,
}: {
  setValue: UseFormSetValue<InvoiceDraftInput>;
  /** Live line items (useWatch in the entry); the search query is derived from the focused row like the old watch(). */
  lineItems: InvoiceDraftInput['line_items'];
}) {
  const [suggestIdx, setSuggestIdx] = useState<number | null>(null);
  const [isProdSuggestionsOpen, setIsProdSuggestionsOpen] = useState(false);
  const [activeInputRect, setActiveInputRect] = useState<SuggestionRect | null>(null);
  const [activeInputRef, setActiveInputRef] = useState<HTMLInputElement | null>(null);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const productReqIdRef = useRef(0);

  const activeRowDesc = suggestIdx !== null ? (lineItems[suggestIdx]?.description || '') : '';

  useEffect(() => {
    const query = activeRowDesc.trim();
    // Clearing happens inside the timer (react-hooks/set-state-in-effect). The dropdown is hidden while the row text is
    // empty, so the 250 ms delay is invisible; bumping reqId also drops a late response for an older query.
    const reqId = ++productReqIdRef.current;
    const timer = setTimeout(async () => {
      if (suggestIdx === null || !query) {
        setProductOptions([]);
        return;
      }
      const res = await searchProductOptions({ q: query });
      if (reqId === productReqIdRef.current && res.success) {
        setProductOptions(res.data);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [suggestIdx, activeRowDesc]);

  const updateInputRect = (el: HTMLInputElement | null) => {
    if (el) {
      setActiveInputRef(el);
      setActiveInputRect(suggestionRect(el));
    } else {
      setActiveInputRef(null);
      setActiveInputRect(null);
    }
  };

  useEffect(() => {
    if (!activeInputRef) return;

    const handleUpdate = () => {
      const rect = activeInputRef.getBoundingClientRect();
      const view = visibleBounds();
      // The input left the visible area: close instead of leaving a floating box behind.
      if (rect.right <= view.left || rect.left >= view.right || rect.bottom <= view.top || rect.top >= view.bottom) {
        setIsProdSuggestionsOpen(false);
        return;
      }
      setActiveInputRect(suggestionRect(activeInputRef));
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);
    // Opening the phone keyboard resizes only the visual viewport (no window resize event).
    window.visualViewport?.addEventListener('resize', handleUpdate);
    window.visualViewport?.addEventListener('scroll', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      window.visualViewport?.removeEventListener('resize', handleUpdate);
      window.visualViewport?.removeEventListener('scroll', handleUpdate);
    };
  }, [activeInputRef]);

  const handleSelectProduct = (idx: number, prod: ProductOption) => {
    setValue(`line_items.${idx}.product_id`, prod.id);
    setValue(`line_items.${idx}.description`, prod.name);
    setValue(`line_items.${idx}.hsn_sac_code`, prod.hsn_sac_code || '');
    setValue(
      `line_items.${idx}.unit_of_measurement`,
      (prod.unit_of_measurement || 'NOS') as InvoiceDraftInput['line_items'][number]['unit_of_measurement']
    );
    setValue(`line_items.${idx}.unit_price`, prod.default_sale_price_paise / 100);
    if (prod.default_tax_rate_id) {
      setValue(`line_items.${idx}.tax_rate_id`, prod.default_tax_rate_id, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
    setIsProdSuggestionsOpen(false);
    updateInputRect(null);
  };

  const handleDescChange = (idx: number, val: string) => {
    setValue(`line_items.${idx}.description`, val);
    setValue(`line_items.${idx}.product_id`, ''); // Clear product_id for ad-hoc typing
    setSuggestIdx(idx);
    setIsProdSuggestionsOpen(true);
  };

  const handleDescFocus = (idx: number, el: HTMLInputElement) => {
    setSuggestIdx(idx);
    setIsProdSuggestionsOpen(true);
    updateInputRect(el);
  };

  return {
    suggestIdx,
    setSuggestIdx,
    isProdSuggestionsOpen,
    setIsProdSuggestionsOpen,
    activeInputRect,
    updateInputRect,
    productOptions,
    handleSelectProduct,
    handleDescChange,
    handleDescFocus,
  };
}
