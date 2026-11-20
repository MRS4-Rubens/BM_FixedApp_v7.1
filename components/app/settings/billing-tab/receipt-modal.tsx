'use client';

import { createPortal } from 'react-dom';
import { usePageScrollLock } from '@/lib/hooks/use-page-scroll-lock';
import { useIsClient } from '@/lib/hooks/use-is-client';
import { X, CheckCircle2, Clock, AlertCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { formatPaiseAsInr } from '@/lib/money';
import type { SubscriptionHistoryItem } from './types';

interface ReceiptModalProps {
  selectedReceipt: SubscriptionHistoryItem | null;
  businessLegalName?: string | null;
  onClose: () => void;
}

export function ReceiptModal({
  selectedReceipt,
  businessLegalName,
  onClose,
}: ReceiptModalProps) {
  const mounted = useIsClient();
  usePageScrollLock(Boolean(selectedReceipt));
  if (!selectedReceipt || !mounted) return null;

  const handlePrintReceipt = () => {
    window.print();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs print:p-0 print:bg-white">
      <div data-viewport-dialog className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl print:border-none print:shadow-none print:p-0">
        {/* Close Button (Hidden in Print) */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer print:hidden"
          title="Close" aria-label="Close receipt"
        >
          <X className="size-5" />
        </button>

        {/* Receipt Content */}
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-4 text-center">
            <div className="inline-flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-extrabold text-lg mb-2 shadow-xs">
              B
            </div>
            <h4 className="text-lg font-extrabold text-slate-900 font-heading">INVOICE BIZFOLIO</h4>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Subscription Payment Voucher
            </p>
          </div>

          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200">
              <span className="text-slate-500">Transaction ID:</span>
              <span className="font-mono font-bold text-slate-900">{selectedReceipt.id.slice(0, 8)}...</span>
            </div>
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200">
              <span className="text-slate-500">Business:</span>
              <span className="font-bold text-slate-900">{businessLegalName || 'Account Holder'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200">
              <span className="text-slate-500">Subscription Plan:</span>
              <span className="font-bold text-slate-900 capitalize">
                {selectedReceipt.planName} ({selectedReceipt.billingCycle})
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200">
              <span className="text-slate-500">Claimed Date:</span>
              <span className="font-semibold text-slate-900">
                {formatIstDate(selectedReceipt.createdAt, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200">
              <span className="text-slate-500">Payment Reference (UTR):</span>
              <span className="font-mono font-bold text-indigo-600">{selectedReceipt.paymentReference}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-dashed border-slate-200 items-center">
              <span className="text-slate-500">Status:</span>
              <div className="flex items-center flex-wrap justify-end gap-1.5">
                {selectedReceipt.status === 'approved' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-bold text-emerald-700 shadow-2xs">
                    <CheckCircle2 className="size-3.5" />
                    Approved
                  </span>
                ) : selectedReceipt.status === 'pending' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 text-xs font-bold text-amber-800 shadow-2xs">
                    <Clock className="size-3.5 animate-pulse" />
                    Pending
                  </span>
                ) : (
                  <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200/80 px-2.5 py-0.5 text-xs font-bold text-rose-700 shadow-2xs">
                      <AlertCircle className="size-3.5" />
                      Rejected
                    </span>
                    <span className="text-xs font-semibold text-rose-600">
                      (Reason: {selectedReceipt.rejectReason || 'Administrative decision'})
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-between py-2 items-baseline">
              <span className="text-base font-bold text-slate-900">Total Paid:</span>
              <span className="text-2xl font-black text-slate-900 font-heading">
                {formatPaiseAsInr(selectedReceipt.amountPaise)}
              </span>
            </div>
          </div>

          {/* Action Buttons (Hidden in Print) */}
          <div className="flex gap-2 pt-2 print:hidden">
            <Button
              variant="outline"
              onClick={handlePrintReceipt}
              className="flex-1 h-9 gap-1.5 text-sm font-semibold cursor-pointer border-slate-200"
            >
              <Printer className="size-4" /> Print Voucher
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 h-9 text-sm font-bold cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  , document.body);
}

