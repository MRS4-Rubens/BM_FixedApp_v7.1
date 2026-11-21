'use client';

import { useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { SubscriptionClaimInput } from '@/lib/validations/subscription';
import { IMAGE_PICK_MAX_BYTES, PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/security/upload-limits';
import { formatBytes, shrinkImage } from '@/lib/images/shrink-image';

export function useScreenshotUpload({
  setValue,
  setFormError,
}: {
  setValue: UseFormSetValue<SubscriptionClaimInput>;
  setFormError: (err: string | null) => void;
}) {
  const [screenshotBase64, setScreenshotBase64] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  /** True while a picked screenshot is being shrunk; the claim cannot be submitted until it is ready. */
  const [isPreparingScreenshot, setIsPreparingScreenshot] = useState(false);

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > IMAGE_PICK_MAX_BYTES) {
      setFormError('This image is too large to process. Please choose a screenshot under 25 MB.');
      return;
    }

    // B9b: payment proofs are stored at <= 50 KB. Shrink here; 1280 px keeps the UTR and amount readable for approval.
    setFormError(null);
    setIsPreparingScreenshot(true);
    void shrinkImage(file, { maxBytes: PAYMENT_SCREENSHOT_MAX_BYTES, maxEdge: 1280, minEdge: 640 }).then((shrunk) => {
      setIsPreparingScreenshot(false);
      if (!shrunk) {
        setFormError('This screenshot could not be made small enough (50 KB). Please crop it to the payment details and try again.');
        return;
      }
      setFileName(file.name);
      setFileSizeStr(`${formatBytes(shrunk.blob.size)} (optimised from ${formatBytes(file.size)})`);
      setValue('screenshot_mime', shrunk.mime);
      setScreenshotBase64(shrunk.dataUrl);
      setValue('screenshot_base64', shrunk.dataUrl);
    });
  };

  const handleRemoveScreenshot = () => {
    setFileName('');
    setFileSizeStr('');
    setScreenshotBase64('');
    setValue('screenshot_base64', '');
    setValue('screenshot_mime', '');
  };

  return {
    screenshotBase64,
    setScreenshotBase64,
    fileName,
    setFileName,
    fileSizeStr,
    setFileSizeStr,
    handleScreenshotChange,
    handleRemoveScreenshot,
    isPreparingScreenshot,
  };
}

