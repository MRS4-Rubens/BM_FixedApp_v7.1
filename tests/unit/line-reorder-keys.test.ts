import { describe, expect, it } from 'vitest';
import { lineReorderHandleId, reorderTargetForKey } from '@/components/app/invoices/invoice-form/use-line-reorder';

describe('Line reorder: grip-handle keyboard keys', () => {
  it('ArrowUp / ArrowDown move one place', () => {
    expect(reorderTargetForKey('ArrowUp', 3, 7)).toBe(2);
    expect(reorderTargetForKey('ArrowDown', 3, 7)).toBe(4);
  });

  it('Home / End jump to the first / last position', () => {
    expect(reorderTargetForKey('Home', 4, 7)).toBe(0);
    expect(reorderTargetForKey('End', 1, 7)).toBe(6);
  });

  it('does nothing at the edges or when already in place', () => {
    expect(reorderTargetForKey('ArrowUp', 0, 7)).toBeNull();
    expect(reorderTargetForKey('ArrowDown', 6, 7)).toBeNull();
    expect(reorderTargetForKey('Home', 0, 7)).toBeNull();
    expect(reorderTargetForKey('End', 6, 7)).toBeNull();
  });

  it('ignores every other key, so typing and Tab keep working', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'a', 'Escape']) {
      expect(reorderTargetForKey(key, 3, 7)).toBeNull();
    }
  });

  it('with a single line nothing can move', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(reorderTargetForKey(key, 0, 1)).toBeNull();
    }
  });

  it('handle ids are 1-based so focus can follow a moved row', () => {
    expect(lineReorderHandleId(0)).toBe('reorder-line-1');
    expect(lineReorderHandleId(6)).toBe('reorder-line-7');
  });
});
