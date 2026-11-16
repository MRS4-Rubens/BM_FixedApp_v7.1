import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DraftReadOnlyNotice } from '@/components/app/invoices/draft-read-only-notice';

describe('DraftReadOnlyNotice', () => {
  it('renders the header and explanatory copy for read-only draft viewing', () => {
    const html = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={new Date('2026-11-16T12:00:00.000Z')}
        customerName="Delta Corp"
        grandTotalPaise={118000}
      />
    );

    expect(html).toContain('Draft invoice — not finalized yet');
    expect(html).toContain('Drafts can only be edited by the business owner or team members. You will see the full invoice once it is finalized.');
    expect(html).toContain('href="/invoices"');
    expect(html).toContain('Back to invoices');
  });

  it('renders customer name when provided', () => {
    const html = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={new Date('2026-11-16T12:00:00.000Z')}
        customerName="Delta Corp"
        grandTotalPaise={118000}
      />
    );

    expect(html).toContain('Delta Corp');
    expect(html).not.toContain('Walk-in customer');
  });

  it('falls back to "Walk-in customer" when customerName is null, empty, or whitespace', () => {
    const htmlNull = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={new Date('2026-11-16T12:00:00.000Z')}
        customerName={null}
        grandTotalPaise={50000}
      />
    );
    expect(htmlNull).toContain('Walk-in customer');

    const htmlEmpty = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={new Date('2026-11-16T12:00:00.000Z')}
        customerName="   "
        grandTotalPaise={50000}
      />
    );
    expect(htmlEmpty).toContain('Walk-in customer');
  });

  it('formats invoice date using IST formatting', () => {
    const html = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate="2026-11-16T00:00:00.000Z"
        customerName="Acme Client"
        grandTotalPaise={250000}
      />
    );

    // 2026-11-16 in IST is 16/11/2026
    expect(html).toContain('16/11/2026');
  });

  it('handles null or empty invoice date gracefully with a dash', () => {
    const html = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={null}
        customerName="Acme Client"
        grandTotalPaise={250000}
      />
    );

    expect(html).toContain('—');
  });

  it('formats grand total paise to INR currency display', () => {
    const html = renderToStaticMarkup(
      <DraftReadOnlyNotice
        invoiceDate={new Date('2026-11-16T12:00:00.000Z')}
        customerName="Acme Client"
        grandTotalPaise={118000}
      />
    );

    // 118000 paise = 1,180.00 INR
    expect(html).toContain('1,180.00');
  });
});
