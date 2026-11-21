'use client';

import { FileImage, HelpCircle, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import type { SubscriptionClaimInput } from '@/lib/validations/subscription';

export function ClaimSubmitCard({
  register,
  errors,
  onSubmit,
  isPending,
  showUtrGuide,
  setShowUtrGuide,
  fileName,
  fileSizeStr,
  screenshotBase64,
  handleScreenshotChange,
  handleRemoveScreenshot,
  isPreparingScreenshot = false,
}: {
  register: UseFormRegister<SubscriptionClaimInput>;
  errors: FieldErrors<SubscriptionClaimInput>;
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void> | void;
  isPending: boolean;
  showUtrGuide: boolean;
  setShowUtrGuide: (show: boolean) => void;
  fileName: string;
  fileSizeStr: string;
  screenshotBase64: string;
  handleScreenshotChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveScreenshot: () => void;
  /** A picked screenshot is still being shrunk (B9b). */
  isPreparingScreenshot?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4.5 sm:p-5 shadow-xs space-y-3">
        <div className="border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-bold">
              3
            </span>
            <h2 className="text-lg font-extrabold text-slate-900 font-heading tracking-tight">
              Enter UTR & Submit Verification Claim
            </h2>
          </div>
          <p className="text-sm text-slate-500 mt-1 ml-8">
            Provide your 12-digit transaction reference number and optional receipt screenshot.
          </p>
        </div>

        <div className="space-y-3 pt-0.5">
          {/* UTR Input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="payment_reference" className="text-sm font-bold text-slate-900">
                Transaction UTR / Reference Number *
              </label>
              <button
                type="button"
                onClick={() => setShowUtrGuide(!showUtrGuide)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
              >
                <HelpCircle className="size-4" />
                <span>Where do I find my UTR?</span>
              </button>
            </div>

            <input
              id="payment_reference"
              type="text"
              placeholder="e.g. 423456789012 or UPI Ref / Transaction ID"
              {...register('payment_reference')}
              className={cn(
                'h-10 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-base font-mono uppercase tracking-wider placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 shadow-xs outline-none transition-all focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-500/15',
                errors.payment_reference && 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/10'
              )}
            />

            {errors.payment_reference && (
              <span className="text-xs font-semibold text-rose-500 mt-0.5">
                {errors.payment_reference.message}
              </span>
            )}

            {/* UTR Explainer Accordion */}
            {showUtrGuide && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-slate-700 space-y-1.5 mt-1">
                <p className="font-bold text-slate-900">Where to look for your 12-digit Reference:</p>
                <ul className="space-y-1 text-xs">
                  <li>• <strong>Google Pay:</strong> Open transaction ➔ Copy the 12-digit &quot;UPI transaction ID&quot;.</li>
                  <li>• <strong>PhonePe:</strong> Open transaction history ➔ Look for &quot;UTR Number&quot;.</li>
                  <li>• <strong>Paytm:</strong> View payment details ➔ Copy the &quot;UPI Ref No.&quot;.</li>
                  <li>• <strong>NetBanking (NEFT/IMPS):</strong> Check statement ➔ Look for the alphanumeric &quot;UTR / Ref No.&quot;.</li>
                </ul>
              </div>
            )}
          </div>

          {/* File Uploader */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="payment_screenshot" className="text-sm font-bold text-slate-900">
              Upload Payment Screenshot (Optional but speeds up approval)
            </label>

            {!fileName ? (
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/40 py-3.5 px-4 hover:bg-slate-50 hover:border-indigo-400 transition relative cursor-pointer group">
                <input
                  id="payment_screenshot"
                  aria-label="Upload payment screenshot"
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshotChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <UploadCloud className="size-7 text-slate-400 group-hover:text-indigo-600 transition-colors mb-1" />
                <span className="text-sm font-bold text-slate-900">
                  Click to upload or drag & drop payment screenshot
                </span>
                <span className="text-xs text-slate-500 mt-0.5">
                  JPEG, PNG or WebP — we shrink it to 50 KB for you
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/40 p-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  {screenshotBase64 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={screenshotBase64}
                      alt="Screenshot preview"
                      className="size-10 object-cover rounded-lg border border-slate-200"
                    />
                  ) : (
                    <FileImage className="size-7 text-indigo-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{fileName}</p>
                    <p className="text-xs text-slate-500">{fileSizeStr}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRemoveScreenshot}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                  title="Remove file"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Submit CTA Button */}
        <Button
          type="submit"
          disabled={isPending || isPreparingScreenshot}
          className="mt-3 w-full h-10 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-500 hover:to-violet-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 text-base"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Verifying & Submitting Claim...
            </>
          ) : isPreparingScreenshot ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Preparing screenshot...
            </>
          ) : (
            'Submit Payment Claim for Instant Review'
          )}
        </Button>
      </div>
    </form>
  );
}

