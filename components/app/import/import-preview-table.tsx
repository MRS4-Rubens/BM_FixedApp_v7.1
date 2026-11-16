'use client';

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runBulkImport } from '@/lib/actions/import/run-bulk-import';
import { cn } from '@/lib/utils';
import {
  filterRows,
  importButtonLabel,
  type BulkImportPreviewData,
  type ImportRunResult,
  type RowFilter,
} from './bulk-import-helpers';

export interface ImportPreviewTableProps {
  readonly fileName: string;
  readonly fileBase64: string;
  readonly preview: BulkImportPreviewData;
  readonly isRunning: boolean;
  readonly setIsRunning: (running: boolean) => void;
  readonly onBack: () => void;
  readonly onSuccess: (result: ImportRunResult) => void;
}

export function ImportPreviewTable({
  fileName,
  fileBase64,
  preview,
  isRunning,
  setIsRunning,
  onBack,
  onSuccess,
}: ImportPreviewTableProps) {
  const [filter, setFilter] = useState<RowFilter>(() =>
    preview.summary.errors > 0 ? 'error' : 'all',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredRows = filterRows(preview.rows, filter);
  const readyCount = preview.summary.ready;
  const isImportDisabled = readyCount === 0 || isRunning;

  async function handleImport() {
    if (isImportDisabled) return;

    setErrorMessage(null);
    setIsRunning(true);

    try {
      const res = await runBulkImport({
        kind: preview.kind,
        file_name: fileName,
        file_base64: fileBase64,
      });

      if (!res.success) {
        setErrorMessage(res.error.message);
        return;
      }

      onSuccess(res.data);
    } catch {
      setErrorMessage('Failed to run import. Please try again.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-center">
          <span className="text-xs font-semibold text-slate-500 block">Total</span>
          <span className="text-xl font-extrabold text-slate-900 font-heading">
            {preview.summary.total}
          </span>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-center">
          <span className="text-xs font-semibold text-emerald-700 block">Ready</span>
          <span className="text-xl font-extrabold text-emerald-800 font-heading">
            {preview.summary.ready}
          </span>
        </div>

        <div
          className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-center"
          title="already in your account or repeated"
        >
          <span className="text-xs font-semibold text-amber-700 block">
            Duplicates
          </span>
          <span className="text-xl font-extrabold text-amber-800 font-heading">
            {preview.summary.duplicates}
          </span>
          <span className="text-[10px] text-amber-600 block truncate">
            already in account or repeated
          </span>
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-center">
          <span className="text-xs font-semibold text-rose-700 block">Errors</span>
          <span className="text-xl font-extrabold text-rose-800 font-heading">
            {preview.summary.errors}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
        <span className="text-xs font-semibold text-muted-foreground mr-1">Filter:</span>
        {(
          [
            { id: 'all', label: `All (${preview.summary.total})` },
            { id: 'ready', label: `Ready (${preview.summary.ready})` },
            { id: 'duplicate', label: `Duplicates (${preview.summary.duplicates})` },
            { id: 'error', label: `Errors (${preview.summary.errors})` },
          ] as const
        ).map((tab) => {
          const isActive = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(tab.id)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer',
                isActive
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card max-h-[360px] overflow-y-auto">
        <table className="w-full min-w-[600px] text-left text-xs">
          <caption className="sr-only">Preview of rows to import</caption>
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur-xs font-semibold text-foreground">
            <tr>
              <th className="py-2.5 px-3 w-16">Row</th>
              <th className="py-2.5 px-3 w-48">Name</th>
              <th className="py-2.5 px-3 w-28">Status</th>
              <th className="py-2.5 px-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-slate-700">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => (
                <tr key={row.rowNumber} className="align-top hover:bg-muted/30">
                  <td className="py-2 px-3 font-mono font-medium text-muted-foreground">
                    #{row.rowNumber}
                  </td>
                  <td className="py-2 px-3 font-semibold text-foreground">
                    {row.label || '—'}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {row.status === 'ready' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                        <CheckCircle2 className="size-3 text-emerald-600" />
                        Ready
                      </span>
                    )}
                    {row.status === 'duplicate' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                        <AlertTriangle className="size-3 text-amber-600" />
                        Duplicate
                      </span>
                    )}
                    {row.status === 'error' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                        <AlertCircle className="size-3 text-rose-600" />
                        Error
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground leading-relaxed">
                    {row.issues.length > 0 ? (
                      <ul className="space-y-0.5">
                        {row.issues.map((issue, idx) => (
                          <li key={idx} className="text-rose-700">
                            {issue.column ? (
                              <>
                                <span className="font-semibold text-rose-900">
                                  {issue.column}:
                                </span>{' '}
                                {issue.message}
                              </>
                            ) : (
                              issue.message
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={4}
                  className="py-8 text-center text-xs text-muted-foreground"
                >
                  No rows in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-800"
        >
          <AlertCircle className="size-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isRunning}
          onClick={onBack}
          className="gap-1.5 font-bold cursor-pointer"
        >
          <FileSpreadsheet className="size-4" />
          Choose another file
        </Button>

        <Button
          type="button"
          disabled={isImportDisabled}
          onClick={handleImport}
          className="shadow-md bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-bold h-9 px-5 rounded-lg cursor-pointer"
        >
          {isRunning && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          {isRunning ? 'Importing…' : importButtonLabel(preview.kind, readyCount)}
        </Button>
      </div>
    </div>
  );
}
