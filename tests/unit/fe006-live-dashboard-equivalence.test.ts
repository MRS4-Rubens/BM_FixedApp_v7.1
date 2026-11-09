import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveDashboard, initialActivities, dummyActivities } from '@/components/landing/live-dashboard';

describe('FE-006: live-dashboard activity HTML equivalence (no dangerouslySetInnerHTML)', () => {
  const oldInitialHtmls = [
    'Payment received <span class="font-semibold text-zinc-800">₹42,000</span>',
    'Invoice <span class="font-semibold text-zinc-800">#1292</span> sent via WhatsApp',
    'Follow-up reminder sent to <span class="font-semibold text-zinc-800">StyleDesk</span>',
    'New customer <span class="font-semibold text-zinc-800">AgroTrade</span> onboarded',
  ];

  const oldDummyHtmls = [
    'Payment received <span class="font-semibold text-zinc-800">₹18,500</span>',
    'Invoice <span class="font-semibold text-zinc-800">#1296</span> generated',
    'Follow-up sent to <span class="font-semibold text-zinc-800">ShopSwift</span>',
    'New customer <span class="font-semibold text-zinc-800">UrbanD2C</span> added',
  ];

  it('the real LiveDashboard component renders every initial activity row exactly as the old HTML string did', () => {
    const markup = renderToStaticMarkup(React.createElement(LiveDashboard));
    expect(markup).not.toContain('dangerouslySetInnerHTML');
    for (const oldHtml of oldInitialHtmls) {
      expect(markup).toContain(`<p class="text-zinc-700">${oldHtml}</p>`);
    }
  });

  it('renders initialActivities identically to the legacy dangerouslySetInnerHTML string form', () => {
    expect(initialActivities).toHaveLength(oldInitialHtmls.length);

    initialActivities.forEach((activity, idx) => {
      const rendered = renderToStaticMarkup(
        React.createElement(
          'p',
          { className: 'text-zinc-700' },
          activity.before,
          React.createElement('span', { className: 'font-semibold text-zinc-800' }, activity.strong),
          activity.after,
        ),
      );

      const expected = `<p class="text-zinc-700">${oldInitialHtmls[idx]}</p>`;
      expect(rendered).toBe(expected);
    });
  });

  it('renders dummyActivities identically to the legacy dangerouslySetInnerHTML string form', () => {
    expect(dummyActivities).toHaveLength(oldDummyHtmls.length);

    dummyActivities.forEach((dummy, idx) => {
      const rendered = renderToStaticMarkup(
        React.createElement(
          'p',
          { className: 'text-zinc-700' },
          dummy.before,
          React.createElement('span', { className: 'font-semibold text-zinc-800' }, dummy.strong),
          dummy.after,
        ),
      );

      const expected = `<p class="text-zinc-700">${oldDummyHtmls[idx]}</p>`;
      expect(rendered).toBe(expected);
    });
  });
});
