'use client';

import { useState, useRef, useTransition } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ModalHeader } from '@/components/ui/modal-header';
import { AlertCircle, Camera, CheckCircle2, FileImage, Loader2, Signature } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { uploadBusinessSignature } from '@/lib/actions/business/upload-signature';
import { SignaturePreviewCard } from './signature-settings-panel';
import { processSignatureImage } from './signature-canvas';
import { SIGNATURE_UPLOAD_RULES, CROP_HOW_TO, REJECTION_MESSAGES } from '@/lib/signature/upload-rules';
import { SignatureUploadExamples } from './signature-sample';

export interface SignatureUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
  onSaved: (dataUrl: string) => void;
}

interface DecodedMedia { source: CanvasImageSource; objectUrl: string; width: number; height: number; }

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_WORKING_SIDE_PX = 2400;

function releaseMedia(media: DecodedMedia) {
  URL.revokeObjectURL(media.objectUrl);
  if (typeof ImageBitmap !== 'undefined' && media.source instanceof ImageBitmap) {
    media.source.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas encode failed'))), 'image/png');
  });
}

async function toWorkingMedia(media: DecodedMedia): Promise<DecodedMedia> {
  const longest = Math.max(media.width, media.height);
  if (longest <= MAX_WORKING_SIDE_PX) return media;
  const scale = MAX_WORKING_SIDE_PX / longest;
  const width = Math.max(1, Math.round(media.width * scale));
  const height = Math.max(1, Math.round(media.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return media;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(media.source, 0, 0, width, height);
  const blob = await canvasToBlob(canvas);
  releaseMedia(media);
  return { source: canvas, objectUrl: URL.createObjectURL(blob), width, height };
}

async function decodeImage(file: File, objectUrl: string): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height };
    } catch { /* fall back to HTMLImageElement */ }
  }
  const img = new Image();
  img.src = objectUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Image decode error'));
  });
  return { source: img, width: img.naturalWidth, height: img.naturalHeight };
}

type ModalPhase = 'choose' | 'processing' | 'ready' | 'rejected';

export function SignatureUploadModal({ open, onOpenChange, businessName, onSaved }: SignatureUploadModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('choose');
  const [decodedMedia, setDecodedMedia] = useState<DecodedMedia | null>(null);
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null);
  const [detectedInk, setDetectedInk] = useState<'black' | 'blue'>('black');
  const [rejectionReason, setRejectionReason] = useState<keyof typeof REJECTION_MESSAGES | null>(null);
  const [chooseError, setChooseError] = useState<{ title: string; fix: string } | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Each pick gets a run id; a result that arrives after the dialog was closed or another photo was picked is ignored.
  const runIdRef = useRef(0);

  const resetAllState = () => {
    runIdRef.current += 1;
    if (decodedMedia) releaseMedia(decodedMedia);
    setPhase('choose'); setDecodedMedia(null); setResultDataUrl(null);
    setDetectedInk('black'); setRejectionReason(null); setChooseError(null);
    setIsConfirmed(false); setServerError(null);
  };

  const handleClose = () => { if (!isPending) { resetAllState(); onOpenChange(false); } };

  const handleChooseAnother = () => {
    if (isPending) return;
    runIdRef.current += 1;
    if (decodedMedia) releaseMedia(decodedMedia);
    setDecodedMedia(null); setResultDataUrl(null); setRejectionReason(null);
    setChooseError(null); setIsConfirmed(false); setServerError(null);
    setPhase('choose');
  };

  const handleFileSelected = async (file: File) => {
    setChooseError(null);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setChooseError({ title: REJECTION_MESSAGES.unreadable.title, fix: REJECTION_MESSAGES.unreadable.fix });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setChooseError({ title: 'This image is larger than 10 MB.', fix: 'Please choose a smaller photo.' });
      return;
    }

    const runId = ++runIdRef.current;
    const objectUrl = URL.createObjectURL(file);
    try {
      const decoded = await decodeImage(file, objectUrl);
      const working = await toWorkingMedia({ source: decoded.source, objectUrl, width: decoded.width, height: decoded.height });
      if (decodedMedia) releaseMedia(decodedMedia);
      setDecodedMedia(working);
      setPhase('processing');

      const outcome = await processSignatureImage(working.source, working.width, working.height);
      if (runId !== runIdRef.current) return; // dialog closed or another photo picked meanwhile
      if (outcome.ok) {
        setResultDataUrl(outcome.dataUrl); setDetectedInk(outcome.ink); setPhase('ready');
      } else {
        setRejectionReason(outcome.reason); setPhase('rejected');
      }
    } catch {
      URL.revokeObjectURL(objectUrl);
      if (runId !== runIdRef.current) return;
      setPhase('choose'); // never leave the spinner up after a failure
      setChooseError({ title: REJECTION_MESSAGES.unreadable.title, fix: REJECTION_MESSAGES.unreadable.fix });
    }
  };

  const handleSaveSignature = () => {
    if (!resultDataUrl || !isConfirmed || isPending) return;
    setServerError(null);
    startTransition(async () => {
      const result = await uploadBusinessSignature({ base64Data: resultDataUrl });
      if (result.success) {
        onSaved(resultDataUrl);
        handleClose();
      } else {
        const msg = result.error.fieldErrors?.signature?.[0] || result.error.message || 'Failed to upload signature. Please try again.';
        setServerError(msg);
      }
    });
  };

  const currentRejection = rejectionReason ? REJECTION_MESSAGES[rejectionReason] : null;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-zinc-950/60 backdrop-blur-xs animate-in fade-in duration-150" />
        <Dialog.Viewport className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
          <Dialog.Popup data-viewport-dialog className="relative w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-4 sm:p-5 shadow-xl flex flex-col justify-between">
            <ModalHeader
              tone="tools"
              icon={Signature}
              title="Upload your signature"
              description="Upload and confirm your authorised signature"
              closeLabel="Close signature upload"
              closeDisabled={isPending}
              className="-mx-4 -mt-4 mb-3 sm:-mx-5 sm:-mt-5 -top-4 sm:-top-5"
            />

            <div>
              {/* PHASE: CHOOSE */}
              {phase === 'choose' && (
                <div className="space-y-3.5">
                  {chooseError && (
                    <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2.5">
                      <AlertCircle className="size-4 shrink-0 text-amber-700 mt-0.5" />
                      <div>
                        <p className="font-bold">{chooseError.title}</p>
                        <p className="mt-0.5 text-amber-800">{chooseError.fix}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row gap-5 items-start">
                    {/* Left Column: Dropzone + Rules */}
                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault(); setIsDragging(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f) handleFileSelected(f);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          'border-2 border-dashed rounded-xl p-4 sm:p-5 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5',
                          isDragging ? 'border-amber-800 bg-amber-50/50' : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
                        )}
                      >
                        <div className="size-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-900 mb-0.5">
                          <FileImage className="size-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            Drop your signature photo here, or <span className="text-amber-800 underline">browse</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG or WEBP up to 10 MB</p>
                        </div>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileSelected(f);
                          e.target.value = '';
                        }}
                      />

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
                            const f = e.target.files?.[0];
                            if (f) handleFileSelected(f);
                            e.target.value = '';
                          }}
                        />
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Rules</h4>
                        <ul className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
                          {SIGNATURE_UPLOAD_RULES.map((rule, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <CheckCircle2 className="size-3 text-emerald-700 shrink-0 mt-0.5" />
                              <span>{rule}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Right Column: Visual Examples */}
                    <SignatureUploadExamples />
                  </div>
                </div>
              )}

              {/* PHASE: PROCESSING */}
              {phase === 'processing' && (
                <div role="status" className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="size-8 animate-spin text-amber-800" />
                  <p className="text-sm font-semibold text-slate-700">Cleaning up your signature…</p>
                </div>
              )}

              {/* PHASE: READY */}
              {phase === 'ready' && resultDataUrl && (
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

                  <div className="flex justify-center p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <SignaturePreviewCard
                      businessName={businessName}
                      hasSignature={true}
                      previewUri={resultDataUrl}
                      className="w-[340px] max-w-full"
                      size="lg"
                    />
                  </div>

                  <p className="text-xs font-medium text-slate-600">
                    Ink detected: <span className="font-semibold text-slate-900">{detectedInk === 'blue' ? 'Blue' : 'Black'}</span>
                  </p>

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

              {/* PHASE: REJECTED */}
              {phase === 'rejected' && currentRejection && (
                <div className="space-y-4">
                  <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="size-5 text-amber-800 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-amber-950">{currentRejection.title}</p>
                        <p className="text-xs text-amber-900 leading-relaxed">{currentRejection.fix}</p>
                      </div>
                    </div>

                    {currentRejection.showCropHelp && (
                      // Uncropped photo: the crop steps ARE the fix, so show them already opened.
                      <details
                        open={rejectionReason === 'too_small'}
                        className="mt-4 text-xs bg-white/70 p-3 rounded-lg border border-amber-200"
                      >
                        <summary className="cursor-pointer font-semibold text-amber-900">
                          How to crop a photo on your phone or computer
                        </summary>
                        <div className="mt-2 space-y-1.5 text-slate-700 pl-2 border-l-2 border-amber-300">
                          {CROP_HOW_TO.map((item, idx) => (
                            <p key={idx}>
                              <strong className="text-slate-900">{item.device}:</strong> {item.steps}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div data-modal-footer className="flex items-center justify-between gap-3 pt-3.5 mt-3.5 border-t border-slate-200">
              {phase === 'ready' ? (
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleChooseAnother} className="cursor-pointer">
                  Choose another
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClose} className="cursor-pointer">
                  Cancel
                </Button>
              )}

              {phase === 'ready' && (
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
                      <span>Saving…</span>
                    </>
                  ) : (
                    <span>Save signature</span>
                  )}
                </Button>
              )}

              {phase === 'rejected' && (
                <Button type="button" variant="default" size="sm" disabled={isPending} onClick={handleChooseAnother} className="cursor-pointer bg-emerald-800 hover:bg-emerald-900 text-white">
                  Choose another
                </Button>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
