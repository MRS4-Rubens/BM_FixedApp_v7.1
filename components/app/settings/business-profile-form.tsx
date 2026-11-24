'use client';

import { useState, useEffect, useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Check,
  AlertCircle,
  Building2,
  Calendar,
  Sparkles,
  ReceiptText,
  ArrowRight,
} from 'lucide-react';
import type { businesses } from '@/lib/db/schema';
import { businessProfileSchema, BusinessProfileInput } from '@/lib/validations/business';
import { saveBusinessProfile } from '@/lib/actions/business/save-business-profile';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { ProfileSpotlightTour } from './profile-spotlight-tour';
import {
  GeneralDetailsSection,
  AddressSection,
  BankDetailsSection,
} from './business-profile-sections';

export interface BusinessProfileFormProps {
  business: typeof businesses.$inferSelect | null;
  currentFyLabel: string;
  onSwitchTab?: (tab: string) => void;
  identityLocked?: boolean;
  readOnly?: boolean;
  /** UI stage 1: lets the Settings side panel's Save button submit this form. */
  formId?: string;
  /** UI stage 1: tells the side panel whether a save worked (false also for client-side validation errors). */
  onProgrammaticEdit?: () => void;
  onSaveStart?: () => void;
  onSaveResult?: (ok: boolean) => void;
}

export function BusinessProfileForm({
  business,
  currentFyLabel,
  onSwitchTab,
  identityLocked = false,
  readOnly = false,
  formId,
  onProgrammaticEdit,
  onSaveStart,
  onSaveResult,
}: BusinessProfileFormProps) {
  const isNewBusiness = !business || !business.id;
  const id = useId();
  const [success, setSuccess] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isTourOpen, setIsTourOpen] = useState(isNewBusiness && !readOnly);
  const [showCelebration, setShowCelebration] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    control,
    setValue,
  } = useForm<BusinessProfileInput>({
    resolver: zodResolver(
      // @hookform/resolvers (v5.4.0) relies on a slightly older Zod v4 draft signature
      // where _zod.version.minor was 3. Zod v4.4.3 bumped it to 4, breaking the TS structural match.
      // https://github.com/react-hook-form/resolvers/issues/720
      businessProfileSchema as never
    ),
    defaultValues: business
      ? {
          legal_name: business.legal_name,
          trade_name: business.trade_name || '',
          gstin: business.gstin,
          pan: business.pan || '',
          registration_type: business.registration_type,
          address_line1: business.address_line1,
          address_line2: business.address_line2 || '',
          city: business.city,
          state_code: business.state_code,
          pincode: business.pincode,
          phone: business.phone || '',
          alternate_phone: business.alternate_phone || '',
          email: business.email || '',
          nature_of_business: business.nature_of_business || '',
          invoice_tagline: business.invoice_tagline || '',
          bank_account_name: business.bank_account_name || '',
          bank_account_number: business.bank_account_number || '',
          bank_ifsc: business.bank_ifsc || '',
          bank_name: business.bank_name || '',
        }
      : {
          legal_name: '',
          trade_name: '',
          gstin: '',
          pan: '',
          registration_type: 'regular',
          address_line1: '',
          address_line2: '',
          city: '',
          state_code: '',
          pincode: '',
          phone: '',
          alternate_phone: '',
          email: '',
          nature_of_business: '',
          invoice_tagline: '',
          bank_account_name: '',
          bank_account_number: '',
          bank_ifsc: '',
          bank_name: '',
        },
  });

  // Smart Auto-fill: When GSTIN is typed, automatically extract PAN and pre-fill State code
  const watchedGstin = useWatch({ control, name: 'gstin' });
  const watchedTagline = useWatch({ control, name: 'invoice_tagline' });
  useEffect(() => {
    if (!watchedGstin || readOnly) return;
    const clean = watchedGstin.trim().toUpperCase();

    // 1. Auto extract State code (first 2 digits)
    if (clean.length >= 2) {
      const stateCode = clean.slice(0, 2);
      if (INDIAN_GST_STATES.some((s) => s.code === stateCode)) {
        setValue('state_code', stateCode, { shouldValidate: true });
      }
    }

    // 2. Auto extract PAN (10 chars: chars 2 to 12)
    if (clean.length >= 12) {
      const extractedPan = clean.slice(2, 12);
      setValue('pan', extractedPan, { shouldValidate: true });
    }
  }, [watchedGstin, setValue, readOnly]);

  const onSubmit = async (data: BusinessProfileInput) => {
    if (readOnly) return;
    setSuccess(false);
    setGlobalError(null);
    const result = await saveBusinessProfile(data);

    onSaveResult?.(result.success);
    if (result.success) {
      setSuccess(true);
      if (isNewBusiness) {
        setShowCelebration(true);
      } else {
        setTimeout(() => setSuccess(false), 3000);
      }
    } else {
      if (result.error.fieldErrors) {
        Object.entries(result.error.fieldErrors).forEach(([field, messages]) => {
          if (messages && messages.length > 0) {
            setError(field as keyof BusinessProfileInput, { message: messages[0] });
          }
        });
      } else {
        setGlobalError(result.error.message);
      }
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6 sm:py-4.5 shadow-xs">
      {/* Neutral Banner for Staff / Read-Only Mode */}
      {readOnly && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 p-3.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          Only the business owner can change these details.
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-slate-800 shrink-0" />
          <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">Business Profile</h2>
        </div>

        {/* Guided Tour Trigger Button */}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setIsTourOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer shadow-2xs"
            title="Launch interactive setup tour"
          >
            <Sparkles className="size-3.5" />
            <span>{isNewBusiness ? 'Guided Setup Tour' : 'Replay Tour'}</span>
          </button>
        )}
      </div>
      <p className="mb-3.5 text-sm text-muted-foreground font-semibold">Manage your business information and tax details.</p>

      {globalError && (
        <div role="alert" className="mb-3.5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" />
          {globalError}
        </div>
      )}

      {!isNewBusiness ? (
        <div className="mb-3.5 rounded-lg bg-emerald-50/60 px-3.5 py-2.5 border border-emerald-200/80 flex items-center gap-2.5">
          <Calendar className="size-4 text-emerald-800 shrink-0" />
          <p className="text-sm font-semibold text-emerald-950">Current Financial Year: {currentFyLabel}</p>
        </div>
      ) : isNewBusiness && !readOnly ? (
        <div className="mb-3.5 rounded-lg bg-emerald-50/80 px-3.5 py-2.5 border border-emerald-200 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <Sparkles className="size-4 text-emerald-800 shrink-0" />
            <p className="text-xs sm:text-sm font-semibold text-emerald-950">
              Welcome! Register your business details below to unlock all invoicing, inventory, and reporting features.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsTourOpen(true)}
            className="shrink-0 text-xs font-bold text-emerald-800 underline hover:text-emerald-950 cursor-pointer"
          >
            Start Guided Tour
          </button>
        </div>
      ) : null}

      <form id={formId} onInvalidCapture={() => onSaveResult?.(false)}
        onSubmit={(event) => {
          if (readOnly) {
            event.preventDefault();
            return;
          }
          onSaveStart?.();
          void handleSubmit(onSubmit, () => onSaveResult?.(false))(event).catch(() => {
            setGlobalError('Could not save your changes. Please try again.');
            onSaveResult?.(false);
          });
        }}>
        <fieldset disabled={readOnly} className="space-y-4 border-0 p-0 m-0">
          {/* SECTION 1: General Details */}
          <GeneralDetailsSection
            onProgrammaticEdit={onProgrammaticEdit}
            id={id}
            register={register}
            errors={errors}
            identityLocked={identityLocked}
            watchedTagline={watchedTagline}
            setValue={setValue}
            readOnly={readOnly}
          />

          {/* SECTION 2: Registered Address */}
          <AddressSection
            id={id}
            register={register}
            errors={errors}
            identityLocked={identityLocked}
            readOnly={readOnly}
          />

          {/* SECTION 3: Bank Details */}
          <BankDetailsSection
            id={id}
            register={register}
            errors={errors}
            readOnly={readOnly}
          />
        </fieldset>

        {/* Informational Callout: Invoice Settings Location */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs mt-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-900 text-white shadow-xs">
              <ReceiptText className="size-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                Invoice Numbering, Templates &amp; Trade Terms
              </p>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Statutory invoice number formatting (GST Rule 46(b)), credit note prefix, payment due days, invoice templates, and footer terms are now managed under the dedicated <span className="font-semibold text-blue-900">Invoice Settings</span> tab.
              </p>
            </div>
          </div>
          {onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab('Invoice Settings')}
              className="btn-shine-navy shrink-0 rounded-lg h-8 px-2.5 text-sm font-bold cursor-pointer flex items-center gap-1 whitespace-nowrap"
            >
              <span className="whitespace-nowrap">Go to Invoice Settings</span>
              <ArrowRight className="size-3.5 shrink-0" />
            </button>
          )}
        </div>

        {/* Save confirmation */}
        <div className="flex items-center justify-between pt-4 gap-2">
          <div>
            {success && (
              <span role="status" className="flex items-center text-sm font-bold text-emerald-800 whitespace-nowrap">
                <Check className="mr-1.5 size-4 shrink-0" /> Profile saved successfully
              </span>
            )}
          </div>
        </div>
      </form>

      {/* On-Screen Registration / Setup Spotlight Tour Component */}
      {!readOnly && (
        <ProfileSpotlightTour
          isOpen={isTourOpen}
          onClose={() => setIsTourOpen(false)}
          showCelebration={showCelebration}
          onCelebrationDismiss={() => setShowCelebration(false)}
        />
      )}
    </div>
  );
}
