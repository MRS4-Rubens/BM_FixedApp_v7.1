'use client';

import { Check, X } from 'lucide-react';

// Clean sample signature graphic data URIs generated from user-provided sample
// Used exclusively for visual instructional examples in the signature upload modal.

const SAMPLE_SIGNATURE_BLACK_DATA_URI =
  'data:image/png;base64,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';

const SAMPLE_SIGNATURE_RED_DATA_URI =
  'data:image/png;base64,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';

export function SignatureUploadExamples() {
  return (
    <div className="w-full md:w-64 shrink-0 md:border-l md:border-slate-200 md:pl-4 space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Photo Examples</h4>

      {/* Correct: Dark ink on plain white paper */}
      <div className="w-full flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-center shadow-2xs">
        <div className="h-9 w-full max-w-[150px] rounded bg-slate-50 flex items-center justify-center border border-slate-100 overflow-hidden px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SAMPLE_SIGNATURE_BLACK_DATA_URI}
            alt="Clean dark ink signature"
            className="h-7 max-w-full object-contain pointer-events-none"
            draggable={false}
          />
        </div>
        <p className="mt-1 text-[11px] font-semibold text-emerald-800 flex items-center justify-center gap-1 whitespace-nowrap">
          <Check className="size-3 shrink-0" />
          <span>Dark ink on plain white paper</span>
        </p>
      </div>

      {/* Wrong 1: Lined paper, shadows or red ink */}
      <div className="w-full flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-center shadow-2xs">
        <div
          className="h-9 w-full max-w-[150px] rounded flex items-center justify-center border border-slate-200 overflow-hidden px-2"
          style={{ backgroundImage: 'repeating-linear-gradient(to bottom, #f8fafc 0px, #f8fafc 7px, #e2e8f0 8px)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SAMPLE_SIGNATURE_RED_DATA_URI}
            alt="Red ink or lined paper"
            className="h-7 max-w-full object-contain pointer-events-none"
            draggable={false}
          />
        </div>
        <p className="mt-1 text-[11px] font-semibold text-rose-700 flex items-center justify-center gap-1 whitespace-nowrap">
          <X className="size-3 shrink-0 text-red-500 dark:text-red-400" />
          <span>Lined paper, shadows, or red ink</span>
        </p>
      </div>

      {/* Wrong 2: Tilted / upright (~60 degrees) */}
      <div className="w-full flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-center shadow-2xs">
        <div className="h-9 w-full max-w-[150px] rounded bg-slate-50 flex items-center justify-center border border-slate-100 overflow-hidden px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SAMPLE_SIGNATURE_BLACK_DATA_URI}
            alt="Tilted signature"
            className="h-7 max-w-full object-contain pointer-events-none -rotate-[60deg] scale-85"
            draggable={false}
          />
        </div>
        <p className="mt-1 text-[11px] font-semibold text-rose-700 flex items-center justify-center gap-1 whitespace-nowrap">
          <X className="size-3 shrink-0 text-red-500 dark:text-red-400" />
          <span>Tilted or upright (please rotate)</span>
        </p>
      </div>
    </div>
  );
}
