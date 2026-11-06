import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SubscriptionRequestEmail } from '@/lib/email/templates/subscription-request-email';

describe('SEC-003: SubscriptionRequestEmail template security', () => {
  const baseProps = {
    businessName: 'Acme Technologies Pvt Ltd',
    ownerEmail: 'owner@acme.test',
    gstin: '29ABCDE1234F1Z5',
    planName: 'growth',
    cycle: 'yearly',
    amountFormatted: '₹9,999.00',
    utr: 'UTR987654321012',
    paymentMethod: 'upi_qr',
    approveLink: 'https://app.billmatrix.test/admin?request=a0000000-0000-4000-8000-000000000001',
  };

  it('renders uploaded screenshot note without any storage/signed URLs when hasScreenshot is true', () => {
    const element = React.createElement(SubscriptionRequestEmail, {
      ...baseProps,
      hasScreenshot: true,
    });
    const html = renderToStaticMarkup(element);

    // Must contain security notice and admin link
    expect(html).toContain('A payment screenshot was uploaded');
    expect(html).toContain('open it from the Admin Console');
    expect(html).toContain(baseProps.approveLink);

    // Must NEVER leak storage hosts, query signatures, or direct download links
    expect(html).not.toContain('X-Amz');
    expect(html).not.toContain('amazonaws');
    expect(html).not.toContain('idrivee2');
    expect(html).not.toContain('Signature=');
    expect(html).not.toContain('View Payment Screenshot');
  });

  it('omits the screenshot note completely when hasScreenshot is false', () => {
    const element = React.createElement(SubscriptionRequestEmail, {
      ...baseProps,
      hasScreenshot: false,
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('A payment screenshot was uploaded');
    expect(html).toContain(baseProps.approveLink);
    expect(html).not.toContain('X-Amz');
    expect(html).not.toContain('amazonaws');
    expect(html).not.toContain('idrivee2');
    expect(html).not.toContain('Signature=');
    expect(html).not.toContain('View Payment Screenshot');
  });
});

