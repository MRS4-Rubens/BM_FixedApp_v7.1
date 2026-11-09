'use client';

import dynamic from 'next/dynamic';

// PERF-005: the preview bundles all four print templates. invoice-form.tsx renders this only while the preview (or its
// template-upgrade prompt, which only opens from inside the preview) is shown, so the code loads on first use instead
// of on every New/Edit Invoice page load. The modal keeps no state of its own; everything lives in the form.
export const InvoicePreviewModal = dynamic(
  () => import('./invoice-preview-modal').then((m) => m.InvoicePreviewModal),
  { ssr: false },
);
