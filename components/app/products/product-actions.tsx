'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { products } from '@/lib/db/schema';
import { deactivateProduct } from '@/lib/actions/products/deactivate-product';
import { reactivateProduct } from '@/lib/actions/products/reactivate-product';
import { useCanEdit } from '@/components/app/current-user-role';

export function ProductActions({ product }: { product: typeof products.$inferSelect }) {
  const canEdit = useCanEdit();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return null;
  }

  const handleToggleActive = async () => {
    setIsPending(true);
    setError(null);
    try {
      if (product.is_active) {
        const res = await deactivateProduct({ id: product.id });
        if (!res.success) {
          setError(res.error.message || 'Action failed. Please try again.');
        }
      } else {
        const res = await reactivateProduct({ id: product.id });
        if (!res.success) {
          setError(res.error.message || 'Action failed. Please try again.');
        }
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start lg:items-end gap-1 shrink-0">
      <Button
        variant={product.is_active ? 'destructive' : 'outline'}
        onClick={handleToggleActive}
        disabled={isPending}
        className="h-9 px-3.5 text-sm font-bold rounded-lg shadow-xs hover:shadow-sm cursor-pointer transition-all hover:-translate-y-px active:translate-y-px whitespace-nowrap shrink-0"
      >
        {isPending ? 'Updating...' : product.is_active ? 'Deactivate Product' : 'Reactivate Product'}
      </Button>
      {error && <p role="alert" className="text-xs text-destructive font-medium">{error}</p>}
    </div>
  );
}
