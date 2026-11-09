'use client';

import { QrCode, CreditCard, ShieldCheck, Mail, Check, Copy } from 'lucide-react';
import { FEEDBACK_RECIPIENT_EMAIL } from '@/lib/config/contact';
import { PayeeNotConfiguredNotice } from './payee-not-configured-notice';
import type { UpiConfig } from './types';

interface SettingsTabProps {
  upiConfig: UpiConfig | null;
  payeeConfigIssue: string | null | undefined;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}

export function SettingsTab({
  upiConfig,
  payeeConfigIssue,
  copiedKey,
  onCopy,
}: SettingsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-foreground font-heading">
          Platform System Settings & Payment Gateways
        </h3>
        <p className="text-xs font-semibold text-muted-foreground">
          These payment details are presented to customers during the Pro upgrade checkout process.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Payee UPI Information */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
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
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
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
            <div className="space-y-2.5 rounded-lg bg-muted/40 p-3.5 border border-border/50 text-sm">
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <span className="text-muted-foreground font-medium">Bank Name:</span>
                <span className="font-bold text-foreground">{upiConfig.bankName}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <span className="text-muted-foreground font-medium">Account Name:</span>
                <span className="font-bold text-foreground">{upiConfig.accName}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <span className="text-muted-foreground font-medium">Account Number:</span>
                <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                  <span>{upiConfig.accNo}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(upiConfig.accNo, 'acc-no')}
                    className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                  >
                    {copiedKey === 'acc-no' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">IFSC Code:</span>
                <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                  <span>{upiConfig.ifsc}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(upiConfig.ifsc, 'ifsc-full')}
                    className="text-muted-foreground hover:text-indigo-600 transition cursor-pointer"
                  >
                    {copiedKey === 'ifsc-full' ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <PayeeNotConfiguredNotice issue={payeeConfigIssue} />
          )}
        </div>

        {/* Platform Security Allowlist */}
        <div className="md:col-span-2 rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
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
        <div className="md:col-span-2 rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
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

