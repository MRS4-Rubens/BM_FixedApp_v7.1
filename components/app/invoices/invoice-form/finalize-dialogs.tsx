'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UpgradePromptModal } from '@/components/app/subscription/upgrade-prompt-modal';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { formatINR } from './form-calculations';
import { CalendarClock, FileCheck2 } from 'lucide-react';

export function FinalizeDialogs({
  showQuotaUpgradeModal,
  setShowQuotaUpgradeModal,
  showFinalizeDialog,
  setShowFinalizeDialog,
  showCrossFyDialog,
  setShowCrossFyDialog,
  crossFyErrorMessage,
  invoiceNumberFormatPreview,
  invoiceDateVal,
  billingNameVal,
  grandTotal,
  executeFinalize,
}: {
  showQuotaUpgradeModal: boolean;
  setShowQuotaUpgradeModal: (show: boolean) => void;
  showFinalizeDialog: boolean;
  setShowFinalizeDialog: (show: boolean) => void;
  showCrossFyDialog: boolean;
  setShowCrossFyDialog: (show: boolean) => void;
  crossFyErrorMessage: string;
  invoiceNumberFormatPreview: string;
  invoiceDateVal?: string;
  billingNameVal: string;
  grandTotal: number;
  executeFinalize: (crossFy?: boolean) => void | Promise<void>;
}) {
  return (
    <>
      <UpgradePromptModal
        isOpen={showQuotaUpgradeModal}
        onClose={() => setShowQuotaUpgradeModal(false)}
        title="Monthly Invoice Limit Reached"
        featureName="Unlimited Monthly Invoicing"
        description="You have reached your Free plan limit of 30 invoices this calendar month. Upgrade to Essentials Pro (₹399/mo) for unlimited invoices and full statutory compliance."
        recommendedPlan="essentials"
        ctaText="Upgrade to Essentials Pro (₹399/mo)"
      />

      {/* Accessible statutory finalize confirmation dialog */}
      <ConfirmDialog
        open={showFinalizeDialog}
        onOpenChange={setShowFinalizeDialog}
        title="Finalize invoice?"
        category="document"
        icon={FileCheck2}
        confirmLabel="Finalize invoice"
        description={
          <div className="space-y-3 text-sm">
            <p>
              Once finalized, this invoice cannot be edited — only corrected via a credit note.
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Number:</span>
                <span className="font-semibold text-foreground">{invoiceNumberFormatPreview}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Date:</span>
                <span className="font-semibold text-foreground">
                  {invoiceDateVal ? formatIstDate(invoiceDateVal, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Today'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-semibold text-foreground">{billingNameVal || '—'}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-1.5 mt-1">
                <span className="text-muted-foreground font-medium">Grand Total:</span>
                <span className="font-bold text-foreground">{formatINR(grandTotal)}</span>
              </div>
            </div>
          </div>
        }
        onConfirm={() => executeFinalize(false)}
      />

      {/* Accessible cross-financial-year confirmation dialog */}
      <ConfirmDialog
        open={showCrossFyDialog}
        onOpenChange={setShowCrossFyDialog}
        title="Finalize back-dated invoice?"
        category="caution"
        icon={CalendarClock}
        confirmLabel="Finalize back-dated invoice"
        description={
          <div className="space-y-2 text-sm">
            <p>{crossFyErrorMessage}</p>
            <p className="text-xs text-muted-foreground">
              Proceed with this back-dated invoice?
            </p>
          </div>
        }
        onConfirm={() => executeFinalize(true)}
      />
    </>
  );
}

