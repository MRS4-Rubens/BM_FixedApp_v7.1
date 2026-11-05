import { describe, expect, it } from 'vitest';
import {
  parseCustomerListParams,
  parseInvoiceListParams,
  parseProductListParams,
  parseCreditNoteListParams,
} from '@/lib/invoices/list-params';
import { encodeCursor } from '@/lib/pagination/keyset';

describe('list search params parsing (PERF-001)', () => {
  const fixedNow = new Date('2026-11-05T10:00:00.000Z'); // November 2026

  const validCursor1 = encodeCursor({
    v: 1,
    k: 'ts',
    t: '2026-11-02 10:11:12.123456+00',
    id: 'a0000000-0000-4000-8000-000000000001',
  });

  const validCursor2 = encodeCursor({
    v: 1,
    k: 'ts',
    t: '2026-11-01 10:11:12.123456+00',
    id: 'a0000000-0000-4000-8000-000000000002',
  });

  it('parses valid invoice list parameters with all fields populated', () => {
    const params = parseInvoiceListParams(
      {
        tab: 'credit_notes',
        q: '  Acme  ',
        status: 'paid',
        month: '10',
        year: '2025',
        size: '25',
        after: validCursor1,
      },
      fixedNow,
    );

    expect(params.tab).toBe('credit_notes');
    expect(params.q).toBe('Acme');
    expect(params.status).toBe('paid');
    expect(params.month).toBe(10);
    expect(params.year).toBe(2025);
    expect(params.size).toBe(25);
    expect(params.after).toBe(validCursor1);
    expect(params.before).toBeUndefined();
  });

  it('applies defaults when parameters are missing or empty', () => {
    const params = parseInvoiceListParams({}, fixedNow);
    expect(params.tab).toBe('invoices');
    expect(params.q).toBeNull();
    expect(params.status).toBe('all');
    expect(params.month).toBe(11);
    expect(params.year).toBe(2026);
    expect(params.size).toBe(50);
    expect(params.after).toBeUndefined();
    expect(params.before).toBeUndefined();
  });

  it('handles invalid or hostile input without throwing', () => {
    const params = parseInvoiceListParams(
      {
        tab: 'malicious_tab',
        status: 'hacked_status',
        month: '15', // month out of range
        year: '1999', // year before 2017
        size: '999999', // oversized size
        after: 'invalid_garbage_cursor',
      },
      fixedNow,
    );

    expect(params.tab).toBe('invoices');
    expect(params.status).toBe('all');
    expect(params.month).toBe(11); // defaulted
    expect(params.year).toBe(2026); // defaulted
    expect(params.size).toBe(100); // clamped to MAX_PAGE_SIZE
    expect(params.after).toBeUndefined(); // invalid cursor dropped
  });

  it('clamps size parameter to [10, 100]', () => {
    expect(parseInvoiceListParams({ size: '2' }, fixedNow).size).toBe(10);
    expect(parseInvoiceListParams({ size: '500' }, fixedNow).size).toBe(100);
    expect(parseInvoiceListParams({ size: 'abc' }, fixedNow).size).toBe(50);
  });

  it('enforces mutual exclusivity between after and before (after wins)', () => {
    const params = parseInvoiceListParams(
      {
        after: validCursor1,
        before: validCursor2,
      },
      fixedNow,
    );

    expect(params.after).toBe(validCursor1);
    expect(params.before).toBeUndefined();
  });

  it('supports before cursor when after is absent', () => {
    const params = parseInvoiceListParams(
      {
        before: validCursor2,
      },
      fixedNow,
    );

    expect(params.before).toBe(validCursor2);
    expect(params.after).toBeUndefined();
  });

  it('handles repeated array query params using first-wins', () => {
    const params = parseInvoiceListParams(
      {
        month: ['9', '12'],
        size: ['25', '100'],
      },
      fixedNow,
    );

    expect(params.month).toBe(9);
    expect(params.size).toBe(25);
  });

  it('parses customer list parameters with includeInactive flag', () => {
    const p1 = parseCustomerListParams({ search: 'Sharma', includeInactive: '1' });
    expect(p1.q).toBe('Sharma');
    expect(p1.includeInactive).toBe(true);

    const p2 = parseCustomerListParams({ q: 'Patel', inactive: 'true' });
    expect(p2.q).toBe('Patel');
    expect(p2.includeInactive).toBe(true);

    const p3 = parseCustomerListParams({});
    expect(p3.includeInactive).toBe(false);
  });

  it('parses product list parameters with kind filtering', () => {
    expect(parseProductListParams({ kind: 'service' }).kind).toBe('service');
    expect(parseProductListParams({ kind: 'product' }).kind).toBe('product');
    expect(parseProductListParams({ kind: 'all' }).kind).toBe('all');
    expect(parseProductListParams({ kind: 'unknown' }).kind).toBe('all');
  });

  it('parses credit note list parameters', () => {
    const p = parseCreditNoteListParams({ month: '5', year: '2025', q: 'CN-001' }, fixedNow);
    expect(p.month).toBe(5);
    expect(p.year).toBe(2025);
    expect(p.q).toBe('CN-001');
  });
});
