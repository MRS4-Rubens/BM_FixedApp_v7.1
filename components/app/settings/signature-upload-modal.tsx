'use client';

import { useState, useRef, useEffect, useTransition } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import {
  Camera,
  RotateCw,
  RotateCcw,
  Check,
  X,
  Lock,
  Lightbulb,
  AlertCircle,
  Loader2,
  FileImage,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { uploadBusinessSignature } from '@/lib/actions/business/upload-signature';
import { SIGNATURE_MAX_BYTES } from '@/lib/security/signature-limits';
import { SignaturePreviewCard } from './signature-settings-panel';
import {
  renderProcessedSignature,
  detectDefaultInkColour,
  type ProcessedSignatureResult,
} from './signature-canvas';
import type { InkColour } from '@/lib/signature/process-signature';

export interface SignatureUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
  onSaved: (dataUrl: string) => void;
}

interface DecodedMedia {
  source: CanvasImageSource;
  objectUrl: string;
  width: number;
  height: number;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Phone photos are downscaled once so every crop/slider re-render stays fast. 2400 px still gives 2.6× the 900 px output. */
const MAX_WORKING_SIDE_PX = 2400;

function releaseMedia(media: DecodedMedia) {
  URL.revokeObjectURL(media.objectUrl);
  if (typeof ImageBitmap !== 'undefined' && media.source instanceof ImageBitmap) {
    media.source.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))), 'image/png');
  });
}

/**
 * If the decoded image is larger than MAX_WORKING_SIDE_PX, redraw it smaller and return a new
 * source + object URL. The cropper and the canvas must use the SAME pixels, otherwise the crop
 * coordinates would not line up.
 */
async function toWorkingMedia(media: DecodedMedia): Promise<DecodedMedia> {
  const longest = Math.max(media.width, media.height);
  if (longest <= MAX_WORKING_SIDE_PX) return media;

  const scale = MAX_WORKING_SIDE_PX / longest;
  const width = Math.max(1, Math.round(media.width * scale));
  const height = Math.max(1, Math.round(media.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return media;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(media.source, 0, 0, width, height);

  const blob = await canvasToBlob(canvas);
  releaseMedia(media);
  return { source: canvas, objectUrl: URL.createObjectURL(blob), width, height };
}

export function SignatureUploadModal({
  open,
  onOpenChange,
  businessName,
  onSaved,
}: SignatureUploadModalProps) {
  // Step state: 1: Choose, 2: Adjust, 3: Confirm
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Decoded image state
  const [decodedMedia, setDecodedMedia] = useState<DecodedMedia | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Cropper state
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // Processing adjustments
  const [ink, setInk] = useState<InkColour>('black');
  const [strength, setStrength] = useState(50);
  const [processedResult, setProcessedResult] = useState<ProcessedSignatureResult | null>(null);

  // Step 3 Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Clean up object URLs when modal unmounts or closes
  const resetAllState = () => {
    if (decodedMedia) releaseMedia(decodedMedia);
    setStep(1);
    setDecodedMedia(null);
    setFileError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
    setInk('black');
    setStrength(50);
    setProcessedResult(null);
    setIsConfirmed(false);
    setServerError(null);
  };

  const handleClose = () => {
    if (isPending) return;
    resetAllState();
    onOpenChange(false);
  };

  // Process image when adjustments change (debounced ~150ms)
  useEffect(() => {
    if (step < 2 || !decodedMedia || !croppedAreaPixels) return;

    // A slower, older render must never overwrite a newer one.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await renderProcessedSignature({
          image: decodedMedia.source,
          naturalWidth: decodedMedia.width,
          naturalHeight: decodedMedia.height,
          cropAreaPixels: croppedAreaPixels,
          rotation,
          ink,
          strength,
        });
        if (!cancelled) setProcessedResult(result);
      } catch (err) {
        console.error('Signature processing failed:', err);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, decodedMedia, croppedAreaPixels, rotation, ink, strength]);

  const handleFileSelected = async (file: File) => {
    setFileError(null);

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setFileError('Please choose a PNG, JPG or WEBP image.');
      return;
    }

    // Validate 10 MB limit
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError('This image is larger than 10 MB. Please choose a smaller photo.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    try {
      let source: CanvasImageSource;
      let width = 0;
      let height = 0;

      if (typeof createImageBitmap === 'function') {
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
          source = bmp;
          width = bmp.width;
          height = bmp.height;
        } catch {
          // Fall back to HTMLImageElement
          const img = new Image();
          img.src = objectUrl;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image decode error'));
          });
          source = img;
          width = img.naturalWidth;
          height = img.naturalHeight;
        }
      } else {
        const img = new Image();
        img.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Image decode error'));
        });
        source = img;
        width = img.naturalWidth;
        height = img.naturalHeight;
      }

      const working = await toWorkingMedia({ source, objectUrl, width, height });

      if (decodedMedia) releaseMedia(decodedMedia);

      // Detect ink colour automatically
      const detectedInk = detectDefaultInkColour(working.source, working.width, working.height);
      setInk(detectedInk);

      // A new photo starts from a clean crop.
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCroppedAreaPixels(null);
      setProcessedResult(null);
      setDecodedMedia(working);
      setStep(2);
    } catch {
      URL.revokeObjectURL(objectUrl);
      setFileError("We couldn't read this image. Please try another photo.");
    }
  };

  const handleSaveSignature = () => {
    if (!processedResult || !isConfirmed || isPending) return;

    // Check size limit (512 KB)
    const base64Data = processedResult.dataUrl;
    const base64Length = base64Data.length - (base64Data.indexOf(',') + 1);
    const approxBytes = Math.ceil((base64Length * 3) / 4);

    if (approxBytes > SIGNATURE_MAX_BYTES) {
      setServerError('This signature image is too large. Try cropping closer.');
      return;
    }

    setServerError(null);
    startTransition(async () => {
      const result = await uploadBusinessSignature({ base64Data });
      if (result.success) {
        onSaved(base64Data);
        handleClose();
      } else {
        const message =
          result.error.fieldErrors?.signature?.[0] ||
          result.error.message ||
          'Failed to upload signature. Please try again.';
        setServerError(message);
      }
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
          <Dialog.Popup className="relative w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 sm:p-6 shadow-xl flex flex-col justify-between">
            {/* Close button */}
            <Dialog.Close
              render={
                <button
                  type="button"
                  aria-label="Close dialog"
                  disabled={isPending}
                  onClick={handleClose}
                  className="absolute right-3.5 top-3.5 sm:right-4 sm:top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:pointer-events-none"
                >
                  <X className="size-4" />
                </button>
              }
            />

            <div>
              {/* Header & Step Indicator */}
              <div className="mb-4 pr-6">
                <Dialog.Title
                  render={
                    <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                      Upload your signature
                    </h3>
                  }
                />
                <Dialog.Description render={<div className="sr-only">Upload and adjust your authorised signature</div>} />

                {/* Step indicator: 1 Choose · 2 Adjust · 3 Confirm */}
                <div className="flex items-center gap-2 mt-2 text-xs font-medium text-slate-500">
                  <span className={cn('flex items-center gap-1', step === 1 && 'font-bold text-amber-800')}>
                    {step > 1 ? <Check className="size-3 text-emerald-700 stroke-[3]" /> : '1'}
                    <span>Choose</span>
                  </span>
                  <span>·</span>
                  <span className={cn('flex items-center gap-1', step === 2 && 'font-bold text-amber-800')}>
                    {step > 2 ? <Check className="size-3 text-emerald-700 stroke-[3]" /> : '2'}
                    <span>Adjust</span>
                  </span>
                  <span>·</span>
                  <span className={cn('flex items-center gap-1', step === 3 && 'font-bold text-amber-800')}>
                    <span>3 Confirm</span>
                  </span>
                </div>
              </div>

              {/* STEP 1: Choose photo */}
              {step === 1 && (
                <div className="space-y-4">
                  {fileError && (
                    <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs font-semibold text-destructive flex items-center gap-2">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{fileError}</span>
                    </div>
                  )}

                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2',
                      isDragging
                        ? 'border-amber-800 bg-amber-50/50'
                        : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
                    )}
                  >
                    <div className="size-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 mb-1">
                      <FileImage className="size-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        Drop your signature photo here, or <span className="text-amber-800 underline">browse</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        PNG, JPG or WEBP up to 10 MB
                      </p>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                      e.target.value = ''; // allow choosing the same file again
                    }}
                  />

                  {/* Mobile photo capture button */}
                  <div className="sm:hidden">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2 text-xs font-semibold cursor-pointer"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="size-4" />
                      <span>Take a photo</span>
                    </Button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelected(file);
                        e.target.value = ''; // allow choosing the same file again
                      }}
                    />
                  </div>

                  {/* Tips Panel */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <Lightbulb className="size-3.5 text-amber-600" />
                      <span>Tips for best results</span>
                    </h4>
                    <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                      <li>Sign with a blue or black pen on plain white paper</li>
                      <li>Take the photo in good, even light with no shadows</li>
                      <li>Keep the paper flat and fill the frame with your signature</li>
                      <li>We&apos;ll crop it, remove the background and keep only the ink</li>
                    </ul>

                    {/* Example visual tiles (CSS/SVG only) */}
                    <div className="grid grid-cols-2 gap-2.5 pt-2">
                      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2.5 text-center shadow-2xs">
                        <div className="h-10 w-full rounded bg-slate-50 flex items-center justify-center border border-slate-100">
                          <svg viewBox="0 0 100 30" className="h-7 w-20 text-slate-900" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M 10,20 Q 25,5 40,18 T 70,12 T 90,22" />
                            <path d="M 30,22 L 85,22" strokeWidth="1.5" strokeDasharray="3 3" />
                          </svg>
                        </div>
                        <p className="mt-1.5 text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                          <Check className="size-3" />
                          <span>Dark ink on white paper</span>
                        </p>
                      </div>

                      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2.5 text-center shadow-2xs">
                        <div
                          className="h-10 w-full rounded flex items-center justify-center border border-slate-200"
                          style={{
                            backgroundImage: 'repeating-linear-gradient(to bottom, #f8fafc 0px, #f8fafc 7px, #e2e8f0 8px)',
                          }}
                        >
                          <svg viewBox="0 0 100 30" className="h-7 w-20 text-rose-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M 10,15 Q 30,25 50,10 T 90,18" />
                          </svg>
                        </div>
                        <p className="mt-1.5 text-[11px] font-semibold text-rose-700 flex items-center gap-1">
                          <X className="size-3" />
                          <span>Lined paper or shadows</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Privacy line */}
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground pt-1">
                    <Lock className="size-3 shrink-0" />
                    <span>Stored privately. It is printed only on your own invoices and credit notes and is never shared through a public link.</span>
                  </div>
                </div>
              )}

              {/* STEP 2: Adjust & Clean-up */}
              {step === 2 && decodedMedia && (
                <div className="space-y-4">
                  {/* Cropper Container */}
                  <div className="relative h-56 sm:h-64 rounded-lg bg-slate-100 overflow-hidden border border-slate-200">
                    <Cropper
                      image={decodedMedia.objectUrl}
                      crop={crop}
                      zoom={zoom}
                      rotation={rotation}
                      aspect={3}
                      minZoom={1}
                      maxZoom={4}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onRotationChange={setRotation}
                      onCropComplete={(_croppedArea, croppedPixels) => {
                        setCroppedAreaPixels(croppedPixels);
                      }}
                    />
                  </div>

                  {/* Controls: Zoom, Rotate, Reset */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    {/* Zoom slider */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700 w-12">Zoom</span>
                      <input
                        type="range"
                        min={1}
                        max={4}
                        step={0.05}
                        value={zoom}
                        aria-label="Zoom"
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="w-full accent-amber-800"
                      />
                    </div>

                    {/* Rotate & Reset buttons */}
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label="Rotate 90 degrees"
                        onClick={() => setRotation((prev) => (prev + 90) % 360)}
                        className="cursor-pointer gap-1 text-xs"
                      >
                        <RotateCw className="size-3.5" />
                        <span>Rotate 90°</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Reset crop"
                        onClick={() => {
                          setCrop({ x: 0, y: 0 });
                          setZoom(1);
                          setRotation(0);
                          setStrength(50);
                        }}
                        className="cursor-pointer gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                        <span>Reset</span>
                      </Button>
                    </div>
                  </div>

                  {/* Ink Colour Segmented Control & Background Clean-up Slider */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    {/* Ink colour segmented control */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                        Ink colour
                      </label>
                      <div
                        role="radiogroup"
                        aria-label="Ink colour"
                        className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-100"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ink === 'black'}
                          onClick={() => setInk('black')}
                          className={cn(
                            'px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer',
                            ink === 'black'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          )}
                        >
                          Black
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ink === 'blue'}
                          onClick={() => setInk('blue')}
                          className={cn(
                            'px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer',
                            ink === 'blue'
                              ? 'bg-blue-900 text-white shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          )}
                        >
                          Blue
                        </button>
                      </div>
                    </div>

                    {/* Background clean-up slider */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                          Background clean-up
                        </label>
                        <span className="text-[11px] font-mono text-slate-500">{strength}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={strength}
                        aria-label="Background clean-up"
                        onChange={(e) => setStrength(Number(e.target.value))}
                        className="w-full accent-amber-800"
                      />
                    </div>
                  </div>

                  {/* Live Result Preview */}
                  <div className="pt-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                      Result Preview
                    </p>
                    <div className="flex justify-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <SignaturePreviewCard
                        businessName={businessName}
                        hasSignature={true}
                        previewUri={processedResult?.dataUrl || null}
                      />
                    </div>

                    {/* Validation feedback */}
                    {processedResult && !processedResult.validation.ok && (
                      <div role="alert" className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs font-medium text-amber-900 flex items-start gap-2">
                        <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-700" />
                        <span>
                          {processedResult.validation.reason === 'empty'
                            ? "We couldn't find a signature in the frame. Move the frame over your signature or use a darker pen."
                            : 'Too much of the frame looks like ink. Crop closer, or use a photo on plain white paper.'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: Confirm */}
              {step === 3 && processedResult && (
                <div className="space-y-4">
                  {serverError && (
                    <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs font-semibold text-destructive flex items-center gap-2">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{serverError}</span>
                    </div>
                  )}

                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    Check your signature at print scale below. Once saved, it will be added to your new tax invoices and credit notes.
                  </p>

                  {/* Preview at real print scale (~90mm x 30mm) */}
                  <div className="flex justify-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <SignaturePreviewCard
                      businessName={businessName}
                      hasSignature={true}
                      previewUri={processedResult.dataUrl}
                      className="w-[340px] max-w-full"
                      size="lg"
                    />
                  </div>

                  {/* Confirmation checkbox */}
                  <label className="flex items-start gap-2.5 pt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      id="confirm-sig"
                      checked={isConfirmed}
                      onChange={(e) => setIsConfirmed(e.target.checked)}
                      className="size-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-800 mt-0.5 cursor-pointer accent-emerald-800"
                    />
                    <span className="text-xs sm:text-sm text-slate-700 font-medium select-none">
                      I confirm this is my signature, or I am authorised to use it for this business.
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between gap-3 pt-5 mt-4 border-t border-slate-200">
              {/* Left action button */}
              <div>
                {step === 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={handleClose}
                    className="cursor-pointer"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      if (step === 2) setStep(1);
                      if (step === 3) setStep(2);
                    }}
                    className="cursor-pointer"
                  >
                    Back
                  </Button>
                )}
              </div>

              {/* Right action button */}
              <div>
                {step === 1 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={!decodedMedia}
                    onClick={() => setStep(2)}
                    className="cursor-pointer bg-emerald-800 hover:bg-emerald-900 text-white"
                  >
                    Next
                  </Button>
                )}

                {step === 2 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={!processedResult || !processedResult.validation.ok}
                    onClick={() => setStep(3)}
                    className="cursor-pointer bg-emerald-800 hover:bg-emerald-900 text-white"
                  >
                    Next
                  </Button>
                )}

                {step === 3 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={!isConfirmed || isPending}
                    onClick={handleSaveSignature}
                    className="cursor-pointer bg-emerald-800 hover:bg-emerald-900 text-white gap-1.5"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save signature</span>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

