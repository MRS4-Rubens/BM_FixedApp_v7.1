'use client';

import { Building, Check, Copy, ExternalLink, QrCode, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPaiseAsInr } from '@/lib/money';
import { BRAND_NAME } from '@/lib/config/brand';
import type { UpiPaymentOption } from '@/lib/payments/types';
import type { PaymentMethod } from './plans';

export function PaymentMethodCard({
  paymentMethod,
  handleMethodChange,
  activeUpiPayment,
  upiConfig,
  activePricePaise,
  businessLegalName,
  copiedField,
  copyToClipboard,
}: {
  paymentMethod: PaymentMethod;
  handleMethodChange: (method: PaymentMethod) => void;
  activeUpiPayment: UpiPaymentOption;
  upiConfig: {
    upiId: string;
    upiName: string;
    bankName: string;
    accName: string;
    accNo: string;
    ifsc: string;
  };
  activePricePaise: number;
  businessLegalName: string;
  copiedField: string | null;
  copyToClipboard: (text: string, fieldKey: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs">
      <div className="border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-bold">
            2
          </span>
          <h2 className="text-lg font-extrabold text-slate-900 font-heading tracking-tight">
            Select Payment Mode & Transfer
          </h2>
        </div>
        <p className="text-sm text-slate-500 mt-1 ml-8">
          Transfer exact amount to our verified account via UPI QR, UPI ID, or Bank NEFT.
        </p>
      </div>

      {/* Mode Selector Tabs */}
      <div className="mt-3.5 grid grid-cols-3 gap-3">
        {[
          { id: 'upi_qr' as const, label: 'UPI QR Code', icon: QrCode, desc: 'Instant Scan' },
          { id: 'upi_id' as const, label: 'Direct UPI ID', icon: Smartphone, desc: 'Any UPI App' },
          { id: 'bank_transfer' as const, label: 'Bank Transfer', icon: Building, desc: 'NEFT / RTGS' },
        ].map((m) => {
          const Icon = m.icon;
          const isSelected = paymentMethod === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => handleMethodChange(m.id)}
              className={cn(
                'flex flex-col items-center text-center py-2 px-2 rounded-xl border font-bold text-sm tracking-wide transition-all cursor-pointer',
                isSelected
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs'
                  : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
              )}
            >
              <Icon className="size-4 shrink-0 mb-1" />
              <span className="font-extrabold">{m.label}</span>
              <span className="text-xs font-normal text-slate-600 mt-0.5">
                {m.desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interactive Mode Details */}
      <div className="mt-3.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-3 px-4 flex flex-col items-center justify-center">
        {paymentMethod === 'upi_qr' && (
          <div className="text-center flex flex-col items-center max-w-sm">
            <span className="text-sm text-slate-500 font-semibold">
              Scan QR with GPay, PhonePe, Paytm, BHIM, or CRED
            </span>

            {/* QR Container */}
            <div className="mt-2.5 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeUpiPayment.qrDataUrl}
                alt={`UPI QR code to pay ${formatPaiseAsInr(activeUpiPayment.amountPaise)} to ${upiConfig.upiName}`}
                className="size-40"
              />
            </div>

            <div className="mt-2.5 flex flex-col items-center gap-1">
              <div className="text-sm font-bold text-slate-900">
                Pay Amount:{' '}
                <span className="text-indigo-600 font-extrabold text-base font-heading">
                  {formatPaiseAsInr(activeUpiPayment.amountPaise)}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                Payee: <strong>{upiConfig.upiName}</strong>
              </span>
            </div>

            {/* Mobile Intent Direct Link */}
            <a
              href={activeUpiPayment.uri}
              className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 font-bold px-3.5 py-2 text-sm shadow-xs transition-all hover:shadow-sm"
            >
              <Smartphone className="size-4" />
              <span>Open directly in UPI App (Mobile)</span>
              <ExternalLink className="size-4" />
            </a>
          </div>
        )}

        {paymentMethod === 'upi_id' && (
          <div className="w-full max-w-md space-y-3">
            <div className="flex justify-between items-center text-sm pb-1 border-b border-slate-200">
              <span className="font-semibold text-slate-500">Payee Name:</span>
              <span className="font-bold text-slate-900">{upiConfig.upiName || BRAND_NAME}</span>
            </div>

            <div className="flex justify-between items-center bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  UPI ID Address
                </span>
                <span className="text-sm font-mono font-bold text-indigo-700 select-all">
                  {upiConfig.upiId}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(upiConfig.upiId, 'upi')}
                className="h-8 gap-1 text-sm font-semibold cursor-pointer text-slate-600 hover:text-slate-900"
              >
                {copiedField === 'upi' ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-bold">
                    <Check className="size-4" /> Copied
                  </span>
                ) : (
                  <>
                    <Copy className="size-4 mr-1" /> Copy
                  </>
                )}
              </Button>
            </div>

            <div className="rounded-lg bg-slate-100 p-2.5 text-sm text-slate-600">
              <p>
                Open your UPI app (GPay/PhonePe), choose <strong>Pay to UPI ID</strong>, paste the address, enter{' '}
                <strong className="text-slate-900">{formatPaiseAsInr(activePricePaise)}</strong>, and complete the transfer.
              </p>
            </div>
          </div>
        )}

        {paymentMethod === 'bank_transfer' && (
          <div className="w-full max-w-md space-y-2.5">
            <div className="grid grid-cols-2 gap-3 pb-2 border-b border-slate-200 text-sm">
              <div>
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                  Bank Name
                </span>
                <span className="font-bold text-slate-900">{upiConfig.bankName}</span>
              </div>
              <div>
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block">
                  Beneficiary Name
                </span>
                <span className="font-bold text-slate-900">{upiConfig.accName}</span>
              </div>
            </div>

            {/* Account Number */}
            <div className="flex justify-between items-center bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Account Number
                </span>
                <span className="text-sm font-mono font-bold text-slate-900 select-all">
                  {upiConfig.accNo}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(upiConfig.accNo, 'acc')}
                className="h-8 text-sm font-semibold cursor-pointer text-slate-600 hover:text-slate-900"
              >
                {copiedField === 'acc' ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-bold">
                    <Check className="size-4" /> Copied
                  </span>
                ) : (
                  <>
                    <Copy className="size-4 mr-1" /> Copy
                  </>
                )}
              </Button>
            </div>

            {/* IFSC Code */}
            <div className="flex justify-between items-center bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  IFSC Code
                </span>
                <span className="text-sm font-mono font-bold text-slate-900 select-all">
                  {upiConfig.ifsc}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(upiConfig.ifsc, 'ifsc')}
                className="h-8 text-sm font-semibold cursor-pointer text-slate-600 hover:text-slate-900"
              >
                {copiedField === 'ifsc' ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-bold">
                    <Check className="size-4" /> Copied
                  </span>
                ) : (
                  <>
                    <Copy className="size-4 mr-1" /> Copy
                  </>
                )}
              </Button>
            </div>

            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 font-medium">
              <strong>Important:</strong> Please add your Business Name ({businessLegalName}) in the payment remarks/description so we can match your bank deposit instantly.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

