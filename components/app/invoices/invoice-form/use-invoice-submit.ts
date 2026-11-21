'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import { saveInvoiceDraft } from '@/lib/actions/invoices/save-invoice-draft';
import { finalizeInvoice } from '@/lib/actions/invoices/finalize-invoice';

export function useInvoiceSubmit({
  isPreviewVerified,
  setShowPreviewWarning,
  onDraftSaved,
}: {
  isPreviewVerified: boolean;
  setShowPreviewWarning: (show: boolean) => void;
  /** Called as soon as the invoice exists in the database (drops the browser-only safety copy). */
  onDraftSaved?: () => void;
}) {
  const router = useRouter();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [showQuotaUpgradeModal, setShowQuotaUpgradeModal] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showCrossFyDialog, setShowCrossFyDialog] = useState(false);
  const [crossFyErrorMessage, setCrossFyErrorMessage] = useState('');
  const [pendingFinalizeData, setPendingFinalizeData] = useState<InvoiceDraftInput | null>(null);
  const [pendingSavedInvoiceId, setPendingSavedInvoiceId] = useState<string | null>(null);

  const onSaveDraft = async (data: InvoiceDraftInput) => {
    setGlobalError(null);
    const res = await saveInvoiceDraft(data);
    if (res.success) {
      onDraftSaved?.();
      router.push(`/invoices/${res.data?.invoiceId}`);
    } else {
      setGlobalError(res.error.message);
      if (res.error.code === 'INVOICE_QUOTA_EXCEEDED' || res.error.code === 'QUOTA_EXCEEDED') {
        setShowQuotaUpgradeModal(true);
      }
    }
  };

  const onFinalizeClick = (data: InvoiceDraftInput) => {
    if (!isPreviewVerified) {
      setShowPreviewWarning(true);
      setGlobalError('Please open the Invoice Preview and verify the layout before finalization.');
      const pBtn = document.getElementById('draft-preview-btn');
      if (pBtn) pBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setPendingFinalizeData(data);
    setShowFinalizeDialog(true);
  };

  const executeFinalize = async (crossFy = false) => {
    if (!pendingFinalizeData) return;
    setIsFinalizing(true);
    setGlobalError(null);
    try {
      // Always save the CURRENT form data before finalizing, so edits made after a cancelled attempt (e.g. a
      // back-dated warning) are never lost. Reuse the id of a draft created by an earlier attempt so a new
      // invoice is updated in place instead of creating a duplicate draft.
      const draftRes = await saveInvoiceDraft({
        ...pendingFinalizeData,
        id: pendingFinalizeData.id ?? pendingSavedInvoiceId ?? undefined,
      });
      if (!draftRes.success) {
        setGlobalError(draftRes.error.message);
        if (draftRes.error.code === 'INVOICE_QUOTA_EXCEEDED' || draftRes.error.code === 'QUOTA_EXCEEDED') {
          setShowQuotaUpgradeModal(true);
        }
        setIsFinalizing(false);
        setShowFinalizeDialog(false);
        setShowCrossFyDialog(false);
        return;
      }
      const invoiceId = draftRes.data?.invoiceId ?? null;
      setPendingSavedInvoiceId(invoiceId);
      onDraftSaved?.();

      if (!invoiceId) {
        setIsFinalizing(false);
        setShowFinalizeDialog(false);
        return;
      }

      const finRes = await finalizeInvoice({
        id: invoiceId,
        ...(crossFy ? { confirm_cross_financial_year: true } : {}),
      });

      if (!finRes.success && finRes.error.code === 'INVOICE_DATE_CROSS_FY') {
        setShowFinalizeDialog(false);
        setCrossFyErrorMessage(finRes.error.message);
        setShowCrossFyDialog(true);
        return;
      }

      if (finRes.success) {
        setShowFinalizeDialog(false);
        setShowCrossFyDialog(false);
        router.push(`/invoices/${finRes.data?.invoiceId}`);
      } else {
        setShowFinalizeDialog(false);
        setShowCrossFyDialog(false);
        setGlobalError(finRes.error.message);
        if (finRes.error.code === 'INVOICE_QUOTA_EXCEEDED' || finRes.error.code === 'QUOTA_EXCEEDED') {
          setShowQuotaUpgradeModal(true);
        }
      }
    } finally {
      setIsFinalizing(false);
    }
  };

  return {
    isFinalizing,
    globalError,
    setGlobalError,
    showQuotaUpgradeModal,
    setShowQuotaUpgradeModal,
    showFinalizeDialog,
    setShowFinalizeDialog,
    showCrossFyDialog,
    setShowCrossFyDialog,
    crossFyErrorMessage,
    onSaveDraft,
    onFinalizeClick,
    executeFinalize,
  };
}

