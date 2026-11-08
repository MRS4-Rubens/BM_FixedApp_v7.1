'use client';

import { useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { SubscriptionClaimInput } from '@/lib/validations/subscription';

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

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setFormError('File size is too large. Maximum allowed size is 4MB.');
      return;
    }

    setFileName(file.name);
    setFileSizeStr(`${(file.size / (1024 * 1024)).toFixed(2)} MB`);
    setValue('screenshot_mime', file.type);
    setFormError(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setScreenshotBase64(base64String);
      setValue('screenshot_base64', base64String);
    };
    reader.readAsDataURL(file);
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
  };
}

