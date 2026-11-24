'use client';

import { useState } from 'react';
import {
  Download,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkBulkImport } from '@/lib/actions/import/check-bulk-import';
import {
  CUSTOMER_COLUMNS,
  PRODUCT_COLUMNS,
  type ImportKind,
} from '@/lib/import/columns';
import {
  validateImportFileMeta,
  fileToBase64,
  type BulkImportPreviewData,
} from './bulk-import-helpers';

export interface ImportUploadStepProps {
  readonly kind: ImportKind;
  readonly isRunning: boolean;
  readonly setIsRunning: (running: boolean) => void;
  readonly onChecked: (data: {
    readonly fileName: string;
    readonly fileBase64: string;
    readonly preview: BulkImportPreviewData;
  }) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportUploadStep({
  kind,
  isRunning,
  setIsRunning,
  onChecked,
}: ImportUploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const columns = kind === 'customers' ? CUSTOMER_COLUMNS : PRODUCT_COLUMNS;
  const validation = file ? validateImportFileMeta(file.name, file.size) : null;
  const canCheck = file !== null && validation?.ok === true && !isRunning;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorMessage(null);
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
  }

  async function handleCheck() {
    if (!file || !canCheck) return;

    setErrorMessage(null);
    setIsRunning(true);

    try {
      const base64 = await fileToBase64(file);
      const res = await checkBulkImport({
        kind,
        file_name: file.name,
        file_base64: base64,
      });

      if (!res.success) {
        setErrorMessage(res.error.message);
        return;
      }

      onChecked({
        fileName: file.name,
        fileBase64: base64,
        preview: res.data,
      });
    } catch {
      setErrorMessage('Failed to read or check file. Please try again.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner: Download template + Column guide toggle */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-indigo-950">
              Need a starting point?
            </h3>
            <p className="text-xs text-indigo-800/80 mt-0.5">
              Download our ready-to-use template with formatted headers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/import/template?kind=${kind}`}
              download
              className="btn-shine-indigo inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer"
            >
              <Download className="size-3.5" />
              Download template
            </a>
          </div>
        </div>

        {/* Collapsible Column Guide */}
        <div className="mt-3 border-t border-indigo-100/80 pt-3">
          <button
            type="button"
            onClick={() => setGuideOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 transition cursor-pointer"
            aria-expanded={guideOpen}
          >
            {guideOpen ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {guideOpen ? 'Hide column guide' : 'Show column guide'}
          </button>

          {guideOpen && (
            <div className="mt-2.5 space-y-2">
              <div className="overflow-x-auto rounded-lg border border-indigo-200/60 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-indigo-100 bg-indigo-50/70 text-indigo-900 font-semibold">
                    <tr>
                      <th className="py-2 px-3">Column</th>
                      <th className="py-2 px-3">Requirement</th>
                      <th className="py-2 px-3">Description & Help</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100/60 text-slate-700">
                    {columns.map((col) => (
                      <tr key={col.key} className="hover:bg-indigo-50/30">
                        <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                          {col.header}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {col.required ? (
                            <span className="font-bold text-rose-600">Required</span>
                          ) : (
                            <span className="text-muted-foreground">Optional</span>
                          )}
                        </td>
                        <td className="py-2 px-3 leading-relaxed text-slate-600">
                          {col.help}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Up to 1,000 rows and 2 MB per file. .xlsx or .csv.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* File Selection Area */}
      <div className="space-y-3">
        <label
          htmlFor="bulk-import-file-input"
          className="block text-sm font-bold text-foreground"
        >
          Select Spreadsheet or CSV File
        </label>

        <div className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/20 p-6 text-center hover:bg-muted/30 hover:border-indigo-400 transition-colors">
          <input
            id="bulk-import-file-input"
            type="file"
            accept=".xlsx,.csv"
            disabled={isRunning}
            onChange={handleFileChange}
            className="absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <FileSpreadsheet className="size-10 text-indigo-600/70 mb-2" />
          <p className="text-sm font-semibold text-foreground">
            {file ? file.name : 'Click or drag a file to upload'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {file ? formatFileSize(file.size) : 'Excel (.xlsx) or CSV (.csv) up to 2 MB'}
          </p>
        </div>

        {/* Client pre-check error */}
        {file && validation && !validation.ok && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-800"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{validation.message}</span>
          </div>
        )}

        {/* Server action error */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-800"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="flex items-center justify-end pt-2">
        <Button
          type="button"
          disabled={!canCheck}
          onClick={handleCheck}
          className="btn-shine-violet shadow-md bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-bold h-9 px-5 rounded-lg cursor-pointer"
        >
          {isRunning && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          {isRunning ? 'Checking…' : 'Check file'}
        </Button>
      </div>
    </div>
  );
}
