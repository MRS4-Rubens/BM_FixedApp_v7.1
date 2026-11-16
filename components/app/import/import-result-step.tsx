'use client';

import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImportRunResult } from './bulk-import-helpers';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface ImportResultStepProps {
  readonly result: ImportRunResult;
  readonly onDone: () => void;
}

export function ImportResultStep({ result, onDone }: ImportResultStepProps) {
  const isCustomers = result.kind === 'customers';
  const noun = isCustomers
    ? result.imported === 1
      ? 'customer'
      : 'customers'
    : result.imported === 1
    ? 'product'
    : 'products';

  const hasSkipped = result.summary.duplicates > 0 || result.summary.errors > 0;

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
      <div className="size-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-xs">
        <CheckCircle2 className="size-8" />
      </div>

      <div className="space-y-1.5 max-w-md">
        <h3 className="text-xl font-extrabold text-foreground font-heading">
          Import Completed
        </h3>
        <p className="text-sm font-semibold text-foreground">
          Imported {result.imported} {noun}.
        </p>
        {hasSkipped && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Skipped {plural(result.summary.duplicates, 'duplicate', 'duplicates')} and{' '}
            {plural(result.summary.errors, 'row', 'rows')} with errors. Fix those rows in your file and import again.
          </p>
        )}
      </div>

      <div className="pt-2">
        <Button
          type="button"
          onClick={onDone}
          className="shadow-md bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-bold h-9 px-6 rounded-lg cursor-pointer"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
