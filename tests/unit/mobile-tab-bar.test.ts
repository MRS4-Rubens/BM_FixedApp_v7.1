import { describe, expect, it } from 'vitest';
import { activeTabForPath } from '@/components/app/mobile-tab-bar';

describe('mobile tab bar: which tab is highlighted for a page', () => {
  it.each([
    ['/dashboard', 'dashboard'],
    ['/invoices', 'invoices'],
    ['/invoices/0b6c1d2e-0000-4000-8000-000000000000', 'invoices'],
    ['/credit-notes/abc', 'invoices'],
    ['/invoices/new', 'new'],
    ['/customers', 'customers'],
    ['/customers/new', 'customers'],
    ['/products', 'more'],
    ['/reports', 'more'],
    ['/settings', 'more'],
  ])('%s -> %s', (path, tab) => {
    expect(activeTabForPath(path)).toBe(tab);
  });
});
