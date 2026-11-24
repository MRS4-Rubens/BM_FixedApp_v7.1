'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatIstDate } from '@/lib/invoices/ist-date';
import type { InviteLinkResult } from './types';

export interface InviteLinkPanelProps {
  result: InviteLinkResult;
  businessName: string;
  role?: 'staff' | 'accountant';
  onDone: () => void;
}

export function InviteLinkPanel({ result, businessName, role = 'staff', onDone }: InviteLinkPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed or blocked; user can still select and copy manually
    }
  };

  const formattedExpiry = formatIstDate(result.expiresAt, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const shareMessage =
    role === 'accountant'
      ? `Join ${businessName} on Invoice BizFolio as our accountant (read-only access): ${result.inviteUrl}`
      : `Join ${businessName} on Invoice BizFolio: ${result.inviteUrl}`;

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  return (
    <div
      role="status"
      className={
        result.emailSent
          ? 'rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 sm:p-5 shadow-xs space-y-3.5'
          : 'rounded-xl border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 p-4 sm:p-5 shadow-xs space-y-3.5'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={result.emailSent ? 'size-2 shrink-0 rounded-full bg-emerald-500' : 'size-2 shrink-0 rounded-full bg-amber-500'}
            />
            {result.emailSent
              ? `Invite sent to ${result.email}.`
              : `We couldn't send the e-mail. Share this link with ${result.email} instead.`}
          </h4>
          <p className="text-xs text-muted-foreground">
            You can copy the private invitation link below or share it directly over WhatsApp.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDone}
          className="shrink-0 font-bold text-xs h-8"
        >
          Done
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          readOnly
          value={result.inviteUrl}
          aria-label="Invite link"
          className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs font-mono text-foreground select-all focus:outline-none focus:ring-2 focus:ring-primary/20"
        />

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-9 text-xs font-bold gap-1.5 min-w-[90px]"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-600" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy link</span>
              </>
            )}
          </Button>

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shine-emerald inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs transition-colors"
          >
            <MessageCircle className="size-3.5" />
            <span>Share on WhatsApp</span>
          </a>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-0.5">
        <Info className="size-3.5 shrink-0" />
        <span>The link works once and expires on {formattedExpiry}.</span>
      </div>
    </div>
  );
}
