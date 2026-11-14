// Item selection on the Issue Credit Note page (pure, no React).
//
// Nothing is credited until the user TICKS an item. Ticking fills in the item's full remaining quantity (one click
// credits a whole line; typing replaces it for partial returns). Unticked items never count. This replaced the old
// behaviour where every item started pre-filled with its full quantity, so pressing Finalize straight away credited
// the whole invoice.

export interface CreditSelection {
  /** Ticked line ids → credit quantity (may be 0 while the user is mid-edit; such lines contribute nothing). */
  readonly quantities: Readonly<Record<string, number>>;
}

export interface SelectableLine {
  readonly id: string;
  /** Quantity still available to credit on this line (billed − already credited). */
  readonly remainingQty: number;
}

export const EMPTY_SELECTION: CreditSelection = { quantities: {} };

export function isSelected(sel: CreditSelection, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(sel.quantities, id);
}

/** A line with nothing left to credit can never be ticked. */
export function isSelectable(line: SelectableLine): boolean {
  return line.remainingQty > 0;
}

function withQuantity(sel: CreditSelection, id: string, qty: number): CreditSelection {
  return { quantities: { ...sel.quantities, [id]: qty } };
}

function without(sel: CreditSelection, id: string): CreditSelection {
  const next = { ...sel.quantities };
  delete next[id];
  return { quantities: next };
}

/** Tick → full remaining quantity; untick → removed. Fully credited lines are ignored. */
export function toggleLine(sel: CreditSelection, line: SelectableLine): CreditSelection {
  if (isSelected(sel, line.id)) return without(sel, line.id);
  if (!isSelectable(line)) return sel;
  return withQuantity(sel, line.id, line.remainingQty);
}

/** Header checkbox state. */
export function selectAllState(sel: CreditSelection, lines: readonly SelectableLine[]): 'none' | 'some' | 'all' {
  const selectable = lines.filter(isSelectable);
  const ticked = selectable.filter((l) => isSelected(sel, l.id)).length;
  if (ticked === 0) return 'none';
  return ticked === selectable.length ? 'all' : 'some';
}

/** Header checkbox click: when everything is ticked it clears; otherwise it ticks every selectable line (full qty). */
export function toggleAll(sel: CreditSelection, lines: readonly SelectableLine[]): CreditSelection {
  if (selectAllState(sel, lines) === 'all') return EMPTY_SELECTION;
  let next = sel;
  for (const line of lines) {
    if (isSelectable(line) && !isSelected(next, line.id)) next = withQuantity(next, line.id, line.remainingQty);
  }
  return next;
}

/** Typing in a ticked line's box: clamped to 0…remaining, 3 decimals. Unticked lines are not editable. */
export function setLineQuantity(sel: CreditSelection, line: SelectableLine, raw: number): CreditSelection {
  if (!isSelected(sel, line.id)) return sel;
  const bounded = Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, line.remainingQty));
  return withQuantity(sel, line.id, Math.round(bounded * 1000) / 1000);
}

/** Leaving a ticked line's box at 0 unticks it (not while typing, so clearing the box to retype doesn't untick). */
export function settleLine(sel: CreditSelection, id: string): CreditSelection {
  return isSelected(sel, id) && (sel.quantities[id] ?? 0) <= 0 ? without(sel, id) : sel;
}

/** Lines that actually contribute: ticked AND quantity > 0, in the given line order. */
export function creditedLines(
  sel: CreditSelection,
  lines: readonly SelectableLine[],
): Array<{ id: string; quantity: number }> {
  return lines.flatMap((l) => {
    const q = sel.quantities[l.id];
    return isSelected(sel, l.id) && q !== undefined && q > 0 ? [{ id: l.id, quantity: q }] : [];
  });
}
