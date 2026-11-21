'use client';

import { useState, type TransitionStartFunction } from 'react';
import { QrCode, CreditCard, ShieldCheck, Mail, Check, Copy, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FEEDBACK_RECIPIENT_EMAIL } from '@/lib/config/contact';
import { PayeeNotConfiguredNotice } from './payee-not-configured-notice';
import { EditPayeeDialog } from './edit-payee-dialog';
import type { UpiConfig } from './types';

interface SettingsTabProps {
  upiConfig: UpiConfig | null;
  payeeConfigIssue: string | null | undefined;
  payeeSource: 'database' | 'env';
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  isPending?: boolean;
  startTransition?: TransitionStartFunction;
}

export function SettingsTab({
  upiConfig,
  payeeConfigIssue,
  payeeSource,
  copiedKey,
  onCopy,
  isPending,
  startTransition,
}: SettingsTabProps) {
  const [editPayeeOpen, setEditPayeeOpen] = useState(false);
  const [payeeDialogKey, setPayeeDialogKey] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground font-heading">
            Platform System Settings & Payment Gateways
          </h3>
          <p className="text-xs font-semibold text-muted-foreground">
            These payment details are presented to customers during the Pro upgrade checkout process.
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {payeeSource === 'database'
              ? 'Live source: saved in app (Edit Payment Details)'
              : 'Live source: server .env file (not yet saved in app)'}
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            setPayeeDialogKey((k) => k + 1);
            setEditPayeeOpen(true);
          }}
          className="h-8.5 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold gap-1.5 shadow-xs cursor-pointer self-start sm:self-auto"
        >
          <Edit3 className="size-3.5" />
          Edit Payment Details
        </Button>
      </div>

      <EditPayeeDialog
        key={payeeDialogKey}
        open={editPayeeOpen}
        onOpenChange={setEditPayeeOpen}
        currentConfig={upiConfig}
        isPending={isPending}
        startTransition={startTransition}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Payee UPI Information */}
        <div className="lg:col-span-5 rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-600">
              <QrCode className="size-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground font-heading uppercase tracking-wider">
                Payee UPI Configuration
              </h4>
              <p className="text-xs text-muted-foreground font-semibold">
                Dynamic QR codes and VPA addresses used on /checkout
              </p>
            </div>
          </div>

          {upiConfig ? (
            <div className="space-y-2.5 rounded-lg bg-muted/40 p-3.5 border border-border/50 text-sm">
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <span className="text-muted-foreground font-medium">Payee VPA / UPI ID:</span>
                <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                  <span>{upiConfig.upiId}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(upiConfig.upiId, 'upi-full')}
                    className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                  >
                    {copiedKey === 'upi-full' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Recipient Display Name:</span>
                <span className="font-bold text-foreground">{upiConfig.upiName}</span>
              </div>
            </div>
          ) : (
            <PayeeNotConfiguredNotice issue={payeeConfigIssue} />
          )}
        </div>

        {/* Direct Bank Account */}
        <div className="lg:col-span-7 rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-700">
              <CreditCard className="size-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground font-heading uppercase tracking-wider">
                Direct Bank Transfer Endpoint
              </h4>
              <p className="text-xs text-muted-foreground font-semibold">
                NEFT / RTGS / IMPS instructions for enterprise subscribers
              </p>
            </div>
          </div>

          {upiConfig ? (
            <div className="space-y-3 rounded-lg bg-muted/40 p-3.5 border border-border/50 text-sm">
              {/* Row 1: Bank Name | Account Name */}
              <div className="flex flex-col sm:flex-row sm:items-center divide-y sm:divide-y-0 sm:divide-x divide-border/40 pb-2.5 sm:pb-2 border-b border-border/40 gap-2 sm:gap-0">
                <div className="flex items-center justify-between sm:pr-4 flex-1 min-w-0">
                  <span className="text-muted-foreground font-medium text-xs sm:text-sm">Bank Name:</span>
                  <span className="font-bold text-foreground truncate ml-1.5">{upiConfig.bankName}</span>
                </div>
                <div className="flex items-center justify-between pt-2 sm:pt-0 sm:pl-4 flex-1 min-w-0">
                  <span className="text-muted-foreground font-medium text-xs sm:text-sm">Account Name:</span>
                  <span className="font-bold text-foreground truncate ml-1.5">{upiConfig.accName}</span>
                </div>
              </div>

              {/* Row 2: Account Number | IFSC Code */}
              <div className="flex flex-col sm:flex-row sm:items-center divide-y sm:divide-y-0 sm:divide-x divide-border/40 gap-2 sm:gap-0 pt-0.5">
                <div className="flex items-center justify-between sm:pr-4 flex-1 min-w-0">
                  <span className="text-muted-foreground font-medium text-xs sm:text-sm">Account Number:</span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-foreground ml-1.5">
                    <span>{upiConfig.accNo}</span>
                    <button
                      type="button"
                      onClick={() => onCopy(upiConfig.accNo, 'acc-no')}
                      className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                      title="Copy Account Number"
                    >
                      {copiedKey === 'acc-no' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 sm:pt-0 sm:pl-4 flex-1 min-w-0">
                  <span className="text-muted-foreground font-medium text-xs sm:text-sm">IFSC Code:</span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-foreground ml-1.5">
                    <span>{upiConfig.ifsc}</span>
                    <button
                      type="button"
                      onClick={() => onCopy(upiConfig.ifsc, 'ifsc-full')}
                      className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                      title="Copy IFSC Code"
                    >
                      {copiedKey === 'ifsc-full' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <PayeeNotConfiguredNotice issue={payeeConfigIssue} />
          )}
        </div>

        {/* Platform Security Allowlist */}
        <div className="lg:col-span-12 rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-indigo-600" />
            <h4 className="text-sm font-bold text-foreground font-heading uppercase tracking-wider">
              Platform Admin Authorization Security
            </h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Allowlist source
          </p>
          <div className="rounded-lg bg-muted/40 p-3 border border-border/50 text-sm font-mono text-foreground font-bold break-all">
            Managed in server configuration. Only verified identities are accepted.
          </div>
        </div>

        {/* Feedback & Support Inbox Dispatch */}
        <div className="lg:col-span-12 rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                <Mail className="size-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground font-heading uppercase tracking-wider">
                  Feedback &amp; Bug Report Inbox Dispatch
                </h4>
                <p className="text-xs text-muted-foreground font-semibold">
                  Live destination for all user reviews, bug reports &amp; UI/UX suggestions
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-bold border border-emerald-500/20 self-start sm:self-auto">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Active In-Memory Delivery (0 Cloud/DB Storage)
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            When users submit bug reports or feedback via the topbar or settings form, the payload and screenshots are packaged in-memory and delivered via Resend directly to your inbox. You can reply directly to the submitting user from Gmail.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            <div className="rounded-lg bg-muted/40 p-3 border border-border/50 text-sm">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Active Recipient Email
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-foreground">
                  {FEEDBACK_RECIPIENT_EMAIL}
                </span>
                <button
                  type="button"
                  onClick={() => onCopy(FEEDBACK_RECIPIENT_EMAIL, 'feedback-email')}
                  aria-label="Copy feedback recipient e-mail"
                  className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                >
                  {copiedKey === 'feedback-email' ? (
                    <Check className="size-4 text-emerald-700" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-muted/40 p-3 border border-border/50 text-sm">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Environment Override Variable
              </span>
              <div className="flex items-center justify-between">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground font-bold">
                  FEEDBACK_RECIPIENT_EMAIL
                </code>
                <span className="text-[11px] text-muted-foreground font-medium">
                  Update in .env to change
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

