import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_SELECTION,
  creditedLines,
  isSelected,
  selectAllState,
  setLineQuantity,
  settleLine,
  toggleAll,
  toggleLine,
  type SelectableLine,
} from '@/lib/credit-notes/selection';

const A: SelectableLine = { id: 'a', remainingQty: 20 };
const B: SelectableLine = { id: 'b', remainingQty: 2.5 };
const DONE: SelectableLine = { id: 'done', remainingQty: 0 };
const LINES = [A, B, DONE];

describe('Credit note item selection', () => {
  it('starts with nothing selected, so nothing is credited', () => {
    expect(creditedLines(EMPTY_SELECTION, LINES)).toEqual([]);
    expect(selectAllState(EMPTY_SELECTION, LINES)).toBe('none');
  });

  it('ticking fills the full remaining quantity; unticking removes it', () => {
    const ticked = toggleLine(EMPTY_SELECTION, A);
    expect(isSelected(ticked, 'a')).toBe(true);
    expect(creditedLines(ticked, LINES)).toEqual([{ id: 'a', quantity: 20 }]);
    const unticked = toggleLine(ticked, A);
    expect(isSelected(unticked, 'a')).toBe(false);
    expect(creditedLines(unticked, LINES)).toEqual([]);
  });

  it('a fully credited line can never be ticked', () => {
    expect(toggleLine(EMPTY_SELECTION, DONE)).toBe(EMPTY_SELECTION);
  });

  it('typing is clamped to 0…remaining and rounded to 3 decimals; unticked lines ignore typing', () => {
    let sel = toggleLine(EMPTY_SELECTION, A);
    sel = setLineQuantity(sel, A, 1);
    expect(creditedLines(sel, LINES)).toEqual([{ id: 'a', quantity: 1 }]);
    expect(creditedLines(setLineQuantity(sel, A, 99), LINES)).toEqual([{ id: 'a', quantity: 20 }]);
    expect(creditedLines(setLineQuantity(sel, A, -5), LINES)).toEqual([]);
    expect(creditedLines(setLineQuantity(sel, A, 1.23456), LINES)).toEqual([{ id: 'a', quantity: 1.235 }]);
    expect(setLineQuantity(sel, B, 1)).toBe(sel); // B not ticked
  });

  it('clearing the box keeps the tick while typing, and unticks only when leaving it at 0', () => {
    let sel = toggleLine(EMPTY_SELECTION, A);
    sel = setLineQuantity(sel, A, 0);
    expect(isSelected(sel, 'a')).toBe(true);
    expect(creditedLines(sel, LINES)).toEqual([]); // ticked at 0 contributes nothing
    sel = settleLine(sel, 'a');
    expect(isSelected(sel, 'a')).toBe(false);
    // Leaving a non-zero quantity keeps the tick.
    const kept = settleLine(setLineQuantity(toggleLine(EMPTY_SELECTION, A), A, 3), 'a');
    expect(creditedLines(kept, LINES)).toEqual([{ id: 'a', quantity: 3 }]);
  });

  it('select-all ticks every creditable line at full quantity, skipping fully credited ones; again clears', () => {
    const all = toggleAll(EMPTY_SELECTION, LINES);
    expect(selectAllState(all, LINES)).toBe('all');
    expect(creditedLines(all, LINES)).toEqual([
      { id: 'a', quantity: 20 },
      { id: 'b', quantity: 2.5 },
    ]);
    expect(toggleAll(all, LINES)).toEqual(EMPTY_SELECTION);
  });

  it('select-all from a partial selection keeps edited quantities and ticks the rest', () => {
    const partial = setLineQuantity(toggleLine(EMPTY_SELECTION, A), A, 1);
    expect(selectAllState(partial, LINES)).toBe('some');
    expect(creditedLines(toggleAll(partial, LINES), LINES)).toEqual([
      { id: 'a', quantity: 1 },
      { id: 'b', quantity: 2.5 },
    ]);
  });

  it('the form has no Delete/remove button any more and starts from an empty selection', () => {
    const src = readFileSync(join(process.cwd(), 'components/app/credit-notes/credit-note-form.tsx'), 'utf8');
    expect(src).not.toContain('Trash2');
    expect(src).not.toContain('handleRemoveItem');
    expect(src).toContain('useState<CreditSelection>(EMPTY_SELECTION)');
  });
});
