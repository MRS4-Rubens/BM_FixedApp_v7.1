'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { acceptTeamInvite } from '@/lib/actions/team/accept-team-invite';
import { clearAllUnsavedInvoiceDrafts } from '@/components/app/invoices/invoice-form/use-unsaved-invoice-draft';

/** Feature A: the "Join <business>" button on the invite page. */
export function AcceptInviteButton({ token, businessName }: { token: string; businessName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptTeamInvite({ token });
      if (result.success) {
        router.replace('/dashboard');
        router.refresh();
      } else {
        setError(result.error?.message ?? 'We could not accept this invite. Please try again.');
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={handleAccept} disabled={isPending} className="w-full h-10 font-bold">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Joining…
          </>
        ) : (
          `Join ${businessName}`
        )}
      </Button>
    </div>
  );
}

/** Feature A: lets someone signed in with the wrong account switch to the invited one. */
export function SwitchAccountButton({ continueHref }: { continueHref: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSwitch = () => {
    startTransition(async () => {
      const { authClient } = await import('@/lib/auth/client');
      const result = await authClient.signOut();
      if (!result?.error) clearAllUnsavedInvoiceDrafts();
      router.push(continueHref);
      router.refresh();
    });
  };

  return (
    <Button type="button" variant="outline" onClick={handleSwitch} disabled={isPending} className="w-full h-10 font-bold">
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : 'Sign out and use the invited account'}
    </Button>
  );
}
