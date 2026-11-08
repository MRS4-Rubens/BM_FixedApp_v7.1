'use client';

import { useFormContext } from 'react-hook-form';
import { ClipboardEdit } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-all hover:border-muted-foreground/30 shadow-sm";
const sectionTitleCls = "flex items-center gap-2 mb-2 pb-1.5 border-b border-border";

export function InternalNotesCard() {
  const { register } = useFormContext<InvoiceDraftInput>();

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm flex flex-col h-full">
      <div className={sectionTitleCls}>
        <ClipboardEdit className="size-4 text-primary" />
        <span className="text-sm font-bold text-foreground uppercase tracking-wider">Internal Notes</span>
      </div>
      <textarea
        rows={3}
        placeholder="Provide payment instructions or extra notes to display on the invoice..."
        className={cn(inputCls, 'resize-none flex-1 mt-1.5')}
        {...register('notes')}
      />
    </div>
  );
}

