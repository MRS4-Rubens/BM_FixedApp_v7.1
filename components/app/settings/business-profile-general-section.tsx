'use client';

import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import {
  Building2,
  Store,
  FileSpreadsheet,
  CreditCard,
  ShieldCheck,
  Briefcase,
  Mail,
  Phone,
  PhoneCall,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUPPORT_EMAIL } from '@/lib/config/contact';
import type { BusinessProfileInput } from '@/lib/validations/business';
import { InvoiceTaglineField } from './invoice-tagline-field';

const baseInputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 h-9 text-sm text-slate-900 font-medium placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:ring-2 shadow-2xs transition-all';
const inputGreenClass = `${baseInputClass} focus:ring-emerald-800/15 focus:border-emerald-800`;
const labelClass = 'mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700';
const sectionClass = 'border-b border-[oklch(0.82_0.015_255)] pb-4 mb-4 sm:pb-4.5 sm:mb-4.5 last:border-0 last:mb-0 last:pb-0';
const errorClass = 'mt-1 text-xs font-semibold text-destructive';

export interface GeneralDetailsSectionProps {
  id: string;
  register: UseFormRegister<BusinessProfileInput>;
  errors: FieldErrors<BusinessProfileInput>;
  identityLocked?: boolean;
  signInEmail?: string | null;
  primaryPhoneRequired?: boolean;
  showPrimaryPhonePrompt?: boolean;
  onProgrammaticEdit?: () => void;
  watchedTagline?: string;
  setValue: UseFormSetValue<BusinessProfileInput>;
  readOnly?: boolean;
}

export function GeneralDetailsSection({
  id,
  register,
  errors,
  identityLocked = false,
  signInEmail,
  primaryPhoneRequired = false,
  showPrimaryPhonePrompt = false,
  onProgrammaticEdit,
  watchedTagline = '',
  setValue,
  readOnly = false,
}: GeneralDetailsSectionProps) {
  return (
    <div className={sectionClass}>
      <div className="flex items-center justify-between pb-2 border-b border-[oklch(0.82_0.015_255)] mb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-[11px] font-black text-white shadow-xs">
            1
          </div>
          <Building2 className="size-4 text-emerald-800 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 font-heading tracking-wide uppercase">General Details</h3>
        </div>
        <span className="text-xs font-medium text-muted-foreground">Appears on invoices</span>
      </div>

      <div className="space-y-4">
        <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-2">
          <div data-tour-step="1" className="relative scroll-mt-28">
            <label htmlFor={`${id}-legal-name`} className={labelClass}>
              <Building2 className="size-3.5 text-emerald-800 shrink-0" />
              <span>Legal Name (as per GST / PAN) <span className="text-destructive">*</span></span>
            </label>
            <input
              id={`${id}-legal-name`}
              type="text"
              readOnly={identityLocked}
              disabled={readOnly}
              tabIndex={identityLocked ? -1 : undefined}
              aria-readonly={identityLocked ? 'true' : undefined}
              className={cn(
                inputGreenClass,
                identityLocked && 'pointer-events-none bg-slate-50 text-slate-500 cursor-not-allowed',
                errors.legal_name && 'border-destructive focus:ring-destructive/20'
              )}
              {...register('legal_name')}
            />
            {identityLocked && (
              <p className="mt-1 text-xs text-muted-foreground">
                Locked after invoice finalization. Contact{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-primary underline">
                  {SUPPORT_EMAIL}
                </a>{' '}
                to request changes.
              </p>
            )}
            {errors.legal_name && <p className={errorClass}>{errors.legal_name.message}</p>}
          </div>

          <div data-tour-step="2" className="relative scroll-mt-28">
            <label htmlFor={`${id}-trade-name`} className={labelClass}>
              <Store className="size-3.5 text-emerald-800 shrink-0" />
              <span>Trade Name (Brand Name, Optional)</span>
            </label>
            <input
              id={`${id}-trade-name`}
              type="text"
              disabled={readOnly}
              className={cn(inputGreenClass, errors.trade_name && 'border-destructive focus:ring-destructive/20')}
              {...register('trade_name')}
            />
            {errors.trade_name && <p className={errorClass}>{errors.trade_name.message}</p>}
          </div>
        </div>

        <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-3">
          <div data-tour-step="3" className="relative scroll-mt-28">
            <label htmlFor={`${id}-gstin`} className={labelClass}>
              <FileSpreadsheet className="size-3.5 text-emerald-800 shrink-0" />
              <span>GSTIN <span className="text-destructive">*</span></span>
            </label>
            <input
              id={`${id}-gstin`}
              type="text"
              maxLength={15}
              readOnly={identityLocked}
              disabled={readOnly}
              tabIndex={identityLocked ? -1 : undefined}
              aria-readonly={identityLocked ? 'true' : undefined}
              className={cn(
                inputGreenClass,
                'font-mono uppercase',
                identityLocked && 'pointer-events-none bg-slate-50 text-slate-500 cursor-not-allowed',
                errors.gstin && 'border-destructive focus:ring-destructive/20'
              )}
              {...register('gstin')}
            />
            {errors.gstin && <p className={errorClass}>{errors.gstin.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-pan`} className={labelClass}>
              <CreditCard className="size-3.5 text-emerald-800 shrink-0" />
              <span>PAN (Auto-extracted from GSTIN)</span>
            </label>
            <input
              id={`${id}-pan`}
              type="text"
              maxLength={10}
              disabled
              className={cn(inputGreenClass, 'font-mono uppercase bg-slate-50 text-slate-600')}
              {...register('pan')}
            />
          </div>
          <div className="min-w-0">
            <div id={`${id}-sign-in-email-label`} className={labelClass}>
              <Mail aria-hidden="true" className="size-3.5 shrink-0 text-emerald-800" />
              Sign-in Email
            </div>
            <div
              role="textbox"
              aria-readonly="true"
              aria-labelledby={`${id}-sign-in-email-label`}
              tabIndex={0}
              className={cn(inputGreenClass, 'select-text overflow-x-auto whitespace-nowrap bg-slate-50 text-slate-600')}
            >
              {signInEmail || 'Unavailable'}
            </div>
          </div>
        </div>

        <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-2">
          <div data-tour-step="4" className="relative scroll-mt-28">
            <label htmlFor={`${id}-registration-type`} className={labelClass}>
              <ShieldCheck className="size-3.5 text-emerald-800 shrink-0" />
              <span>GST Registration Type <span className="text-destructive">*</span></span>
            </label>
            <select
              id={`${id}-registration-type`}
              disabled={readOnly}
              className={cn(inputGreenClass, errors.registration_type && 'border-destructive focus:ring-destructive/20')}
              {...register('registration_type')}
            >
              <option value="regular">Regular</option>
              <option value="composition">Composition Scheme</option>
            </select>
            {errors.registration_type && <p className={errorClass}>{errors.registration_type.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-nature-of-business`} className={labelClass}>
              <Briefcase className="size-3.5 text-emerald-800 shrink-0" />
              <span>Nature of Business (Optional)</span>
            </label>
            <input
              id={`${id}-nature-of-business`}
              type="text"
              disabled={readOnly}
              placeholder="e.g. Retail, Wholesale, Manufacturing"
              className={cn(inputGreenClass, errors.nature_of_business && 'border-destructive focus:ring-destructive/20')}
              {...register('nature_of_business')}
            />
            {errors.nature_of_business && <p className={errorClass}>{errors.nature_of_business.message}</p>}
          </div>
        </div>

        <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${id}-email`} className={labelClass}>
              <Mail className="size-3.5 text-emerald-800 shrink-0" />
              <span>Business E-mail</span>
            </label>
            <input
              id={`${id}-email`}
              type="email"
              disabled={readOnly}
              className={cn(inputGreenClass, errors.email && 'border-destructive focus:ring-destructive/20')}
              {...register('email')}
            />
            {errors.email && <p className={errorClass}>{errors.email.message}</p>}
          </div>

          <div data-tour-step="5" className="relative scroll-mt-28">
            <label htmlFor={`${id}-phone`} className={labelClass}>
              <Phone className="size-3.5 text-emerald-800 shrink-0" />
              <span>Primary Phone {primaryPhoneRequired && <span className="text-destructive">*</span>}</span>
            </label>
            <input
              id={`${id}-phone`}
              type="tel"
              autoComplete="tel"
              maxLength={24}
              required={primaryPhoneRequired}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone || showPrimaryPhonePrompt ? `${id}-phone-message` : undefined}
              disabled={readOnly}
              className={cn(inputGreenClass, errors.phone && 'border-destructive focus:ring-destructive/20')}
              {...register('phone')}
            />
            {errors.phone ? (
              <p id={`${id}-phone-message`} className={errorClass}>{errors.phone.message}</p>
            ) : showPrimaryPhonePrompt && (
              <p id={`${id}-phone-message`} className="mt-1 text-xs text-muted-foreground">Add a primary contact number for your business.</p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-alternate-phone`} className={labelClass}>
              <PhoneCall className="size-3.5 text-emerald-800 shrink-0" />
              <span>Alt Phone (Optional)</span>
            </label>
            <input
              id={`${id}-alternate-phone`}
              type="tel"
              disabled={readOnly}
              placeholder="e.g. 9848537068"
              className={cn(inputGreenClass, errors.alternate_phone && 'border-destructive focus:ring-destructive/20')}
              {...register('alternate_phone')}
            />
            {errors.alternate_phone && <p className={errorClass}>{errors.alternate_phone.message}</p>}
          </div>
        </div>

        <div>
          <InvoiceTaglineField
            idPrefix={id}
            registration={register('invoice_tagline')}
            value={watchedTagline}
            error={errors.invoice_tagline?.message}
            onUseExample={(text: string) => {
              onProgrammaticEdit?.();
              setValue('invoice_tagline', text, { shouldDirty: true, shouldValidate: true });
            }}
          />
        </div>
      </div>
    </div>
  );
}
