'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deactivateCustomer } from '@/lib/actions/customers/deactivate-customer';
import { reactivateCustomer } from '@/lib/actions/customers/reactivate-customer';
import { useRouter } from 'next/navigation';
import { Power, PowerOff } from 'lucide-react';

export function CustomerActions({ customerId, isActive }: { customerId: string; isActive: boolean }) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();

  const confirmMessage = isActive 
    ? 'Are you sure you want to deactivate this customer? They will not appear in active lists but their history will be preserved.'
    : 'Are you sure you want to reactivate this customer?';

  const handleConfirmToggle = async () => {
    setLoading(true);
    try {
      const result = isActive 
        ? await deactivateCustomer({ id: customerId })
        : await reactivateCustomer({ id: customerId });
        
      if (result.success) {
        router.refresh();
      } else {
        alert(result.error.message || 'Action failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={isActive ? 'destructive' : 'default'}
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        className="h-9 px-3.5 text-sm font-bold rounded-lg shadow-xs hover:shadow-sm cursor-pointer transition-all hover:-translate-y-px active:translate-y-px whitespace-nowrap shrink-0"
      >
        {isActive ? (
          <>
            <PowerOff className="size-3.5 mr-1.5" />
            Deactivate
          </>
        ) : (
          <>
            <Power className="size-3.5 mr-1.5" />
            Reactivate
          </>
        )}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isActive ? 'Deactivate customer?' : 'Reactivate customer?'}
        description={confirmMessage}
        confirmLabel={isActive ? 'Deactivate' : 'Reactivate'}
        tone={isActive ? 'destructive' : 'default'}
        onConfirm={handleConfirmToggle}
      />
    </>
  );
}
