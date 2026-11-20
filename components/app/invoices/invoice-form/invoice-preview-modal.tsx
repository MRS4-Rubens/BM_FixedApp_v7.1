'use client';

import { createPortal } from 'react-dom';
import { usePageScrollLock } from '@/lib/hooks/use-page-scroll-lock';
import { Eye, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InvoicePrintView, type InvoicePrintViewProps } from '../invoice-print-view';
import { TemplateSelector } from '../template-selector';
import { UpgradePromptModal } from '@/components/app/subscription/upgrade-prompt-modal';
import { isInvoiceTemplateId } from '@/lib/invoices/template-ids';
import type { UseFormSetValue } from 'react-hook-form';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { CurrentBusiness } from '@/lib/auth/current-business';
import type { resolveDraftDisplayPrefs } from '@/lib/invoices/display-prefs';
type ResolvedDraftDisplayPrefs = ReturnType<typeof resolveDraftDisplayPrefs>;

export function InvoicePreviewModal({
  mounted,
  isPreviewOpen,
  setIsPreviewOpen,
  previewInvoiceData,
  business,
  displayPrefs,
  watchTemplate,
  previewPrintSize,
  setPreviewPrintSize,
  isPreviewVerified,
  setIsPreviewVerified,
  setShowPreviewWarning,
  showTemplateUpgradeModal,
  setShowTemplateUpgradeModal,
  setValue,
}: {
  mounted: boolean;
  isPreviewOpen: boolean;
  setIsPreviewOpen: (open: boolean) => void;
  previewInvoiceData: InvoicePrintViewProps['invoice'];
  business: CurrentBusiness;
  displayPrefs: ResolvedDraftDisplayPrefs;
  watchTemplate: string;
  previewPrintSize: 'A4' | 'A5';
  setPreviewPrintSize: (size: 'A4' | 'A5') => void;
  isPreviewVerified: boolean;
  setIsPreviewVerified: (v: boolean) => void;
  setShowPreviewWarning: (v: boolean) => void;
  showTemplateUpgradeModal: boolean;
  setShowTemplateUpgradeModal: (v: boolean) => void;
  setValue: UseFormSetValue<InvoiceDraftInput>;
}) {
  usePageScrollLock(isPreviewOpen);
  const templateWidth = 780 + (displayPrefs.showHsn ? 70 : 0) + (displayPrefs.discEnabled ? 70 : 0);
  const previewMaxWidth = `${templateWidth}px`;
  const modalMaxWidth = `${templateWidth + 80}px`;

  return (
    <>
      {mounted && isPreviewOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-fadeIn print:hidden">
          <div
            data-invoice-preview-frame className="bg-background rounded-xl border border-border shadow-2xl w-full h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            style={{ maxWidth: modalMaxWidth }}
          >
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-2.5 border-b border-border flex flex-row items-center justify-between gap-4 bg-muted/20 overflow-x-auto shrink-0">
              {/* Left Side: Title */}
              <div className="flex items-center gap-2 shrink-0">
                <Eye className="size-5 text-primary" />
                <span className="text-sm font-bold text-foreground uppercase tracking-wider whitespace-nowrap">Invoice Print Preview</span>
              </div>

              {/* Right Side: Grouped Controls */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Template Selector synced with form */}
                <TemplateSelector
                  value={watchTemplate}
                  business={business}
                  compact
                  onChange={(chosen) => {
                    if (isInvoiceTemplateId(chosen)) {
                      setValue('invoice_template', chosen);
                    }
                  }}
                  onUpgradeClick={() => {
                    setValue('invoice_template', 'template_1');
                    setShowTemplateUpgradeModal(true);
                  }}
                />

                {/* Print size/orientation toggle with Print Button */}
                <div className="flex items-center gap-1.5">
                  <div className="flex overflow-hidden rounded-md border border-primary/25 text-[13px] shadow-[0_0_8px_rgba(59,130,246,0.06)] bg-card">
                    {(['A4', 'A5'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPreviewPrintSize(s)}
                        className={cn(
                          "px-3 py-1 transition-all cursor-pointer font-bold",
                          previewPrintSize === s
                            ? 'bg-primary text-primary-foreground font-bold'
                            : 'bg-background text-muted-foreground hover:bg-accent font-semibold first:border-r first:border-border'
                        )}
                        title={`${s} Paper Layout`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex size-8 items-center justify-center rounded-md border border-primary/25 bg-background text-muted-foreground hover:text-foreground transition-all hover:bg-accent shadow-[0_0_8px_rgba(59,130,246,0.06)] cursor-pointer"
                    title="Print Invoice (System Dialog)"
                  >
                    <Printer className="size-[18px]" />
                  </button>
                </div>

                {/* Group containing checkbox and close button with exact 7px gap */}
                <div className="flex items-center gap-[7px]">
                  {/* Preview Verified Checkbox */}
                  <label className={cn(
                    "flex items-center gap-2 cursor-pointer bg-card rounded-md px-3 py-1.5 text-xs font-bold transition-all select-none border",
                    isPreviewVerified
                      ? "border-success/30 dark:border-success/20 shadow-[0_0_10px_rgba(16,185,129,0.08)] hover:border-success/50"
                      : "border-border shadow-sm hover:border-muted-foreground/30"
                  )}>
                    <input
                      type="checkbox"
                      checked={isPreviewVerified}
                      onChange={(e) => {
                        setIsPreviewVerified(e.target.checked);
                        if (e.target.checked) setShowPreviewWarning(false);
                      }}
                      className="rounded border-border text-success focus:ring-success accent-success size-4 cursor-pointer"
                    />
                    <span className={cn(
                      "transition-colors whitespace-nowrap",
                      isPreviewVerified
                        ? "text-success-text font-bold"
                        : "text-muted-foreground font-semibold"
                    )}>
                      Preview Verified
                    </span>
                  </label>

                  {/* Close Button */}
                  <button
                    type="button"
                    aria-label="Close dialog"
                    onClick={() => setIsPreviewOpen(false)}
                    className="sticky right-0 z-10 bg-card rounded-lg p-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-all border border-red-500/25 shadow-[0_0_8px_rgba(239,68,68,0.12)] hover:border-red-500/45 cursor-pointer"
                  >
                    <span className="sr-only">Close</span>
                    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6 bg-zinc-100 dark:bg-zinc-900/60 select-text">
              <div
                className="w-full bg-white shadow-md border border-border transition-all print:p-0 print:border-none print:shadow-none print:rounded-none"
                style={{
                  maxWidth: previewMaxWidth,
                  minWidth: previewMaxWidth,
                  marginInline: 'auto',
                  fontFamily: 'inherit'
                }}
              >
                <InvoicePrintView
                  invoice={previewInvoiceData}
                  businessStateCode={business.state_code}
                  printSize={previewPrintSize}
                  displayPrefs={displayPrefs}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden print container for preview rendering in draft mode */}
      {isPreviewOpen && (
        <div className="hidden print:block bg-white text-slate-900">
          <InvoicePrintView
            invoice={previewInvoiceData}
            businessStateCode={business.state_code}
            printSize={previewPrintSize}
            displayPrefs={displayPrefs}
          />
        </div>
      )}

      <UpgradePromptModal
        isOpen={showTemplateUpgradeModal}
        onClose={() => setShowTemplateUpgradeModal(false)}
        title="Unlock Premium Print Templates"
        featureName="Traditional &amp; Book Depot Print Templates"
        description="Upgrade to Essentials Pro (₹399/mo) to unlock authentic Book Depot, Carbon Pad, and Modern GST invoice print templates."
        recommendedPlan="essentials"
        ctaText="Upgrade to Essentials Pro (₹399/mo)"
      />
    </>
  );
}
