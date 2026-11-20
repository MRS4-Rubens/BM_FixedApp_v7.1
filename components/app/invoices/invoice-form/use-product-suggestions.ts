'use client';

import { useState, useEffect, useRef } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import { searchProductOptions } from '@/lib/actions/products/search-product-options';
import type { ProductOption } from '@/lib/pickers/types';

/** Suggestion box position: under the input, kept inside the screen (8px margin) and flipped above the input when
 * there is no room below (e.g. phone keyboard open). On wide screens this equals the input's own position. */
const SUGGESTION_BOX_HEIGHT = 200;
function suggestionRect(el: HTMLInputElement) {
  const rect = el.getBoundingClientRect();
  const width = Math.min(rect.width, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const bottom = window.visualViewport?.height ?? window.innerHeight;
  const flip = rect.bottom + SUGGESTION_BOX_HEIGHT > bottom && rect.top >= SUGGESTION_BOX_HEIGHT;
  const top = flip ? rect.top - SUGGESTION_BOX_HEIGHT : rect.bottom;
  return { top: top + window.scrollY, left: left + window.scrollX, width, height: rect.height };
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
  const [activeInputRect, setActiveInputRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
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
      // The input scrolled out of view: close instead of leaving a floating box behind.
      if (rect.right <= 0 || rect.left >= window.innerWidth || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setIsProdSuggestionsOpen(false);
        return;
      }
      setActiveInputRect(suggestionRect(activeInputRef));
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
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
