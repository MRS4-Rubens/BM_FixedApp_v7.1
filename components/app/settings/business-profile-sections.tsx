'use client';

import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import {
  MapPin,
  Navigation,
  Globe,
  Hash,
  Landmark,
  UserCheck,
  CreditCard,
  QrCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import type { BusinessProfileInput } from '@/lib/validations/business';

export {
  GeneralDetailsSection,
  type GeneralDetailsSectionProps,
} from './business-profile-general-section';

const baseInputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 h-9 text-sm text-slate-900 font-medium placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:ring-2 shadow-2xs transition-all';
const inputAmberClass = `${baseInputClass} focus:ring-amber-800/15 focus:border-amber-800`;
const inputRoseClass = `${baseInputClass} focus:ring-rose-900/15 focus:border-rose-900`;

const labelClass = 'mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700';
const sectionClass = 'border-b border-border pb-4 mb-4 sm:pb-4.5 sm:mb-4.5 last:border-0 last:mb-0 last:pb-0';
const errorClass = 'mt-1 text-xs font-semibold text-destructive';

export interface AddressSectionProps {
  id: string;
  register: UseFormRegister<BusinessProfileInput>;
  errors: FieldErrors<BusinessProfileInput>;
  identityLocked?: boolean;
  readOnly?: boolean;
}

export function AddressSection({
  id,
  register,
  errors,
  identityLocked = false,
  readOnly = false,
}: AddressSectionProps) {
  return (
    <div className={sectionClass}>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between pb-2 border-b border-border/50 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-amber-800 text-[11px] font-black text-white shadow-xs">
            2
          </div>
          <MapPin className="size-4 text-amber-800 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 font-heading tracking-wide uppercase">Registered Address</h3>
        </div>
        <span className="pl-[54px] sm:pl-0 text-xs font-medium text-muted-foreground">Principal place of business</span>
      </div>

      <div className="space-y-3">
        <div className="grid gap-2.5 sm:gap-3 sm:grid-cols-2">
          <div data-tour-step="6" className="relative scroll-mt-28">
            <label htmlFor={`${id}-address-line1`} className={labelClass}>
              <MapPin className="size-3.5 text-amber-800 shrink-0" />
              <span>Address Line 1 <span className="text-destructive">*</span></span>
            </label>
            <input
              id={`${id}-address-line1`}
              type="text"
              disabled={readOnly}
              className={cn(inputAmberClass, errors.address_line1 && 'border-destructive focus:ring-destructive/20')}
              {...register('address_line1')}
            />
            {errors.address_line1 && <p className={errorClass}>{errors.address_line1.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-address-line2`} className={labelClass}>
              <MapPin className="size-3.5 text-amber-800 shrink-0" />
              <span>Address Line 2 (Optional)</span>
            </label>
            <input
              id={`${id}-address-line2`}
              type="text"
              disabled={readOnly}
              className={cn(inputAmberClass, errors.address_line2 && 'border-destructive focus:ring-destructive/20')}
              {...register('address_line2')}
            />
            {errors.address_line2 && <p className={errorClass}>{errors.address_line2.message}</p>}
          </div>
        </div>

        <div className="grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-12">
          <div data-tour-step="7" className="sm:col-span-5 relative scroll-mt-28">
            <label htmlFor={`${id}-city`} className={labelClass}>
              <Navigation className="size-3.5 text-amber-800 shrink-0" />
              <span>City <span className="text-destructive">*</span></span>
            </label>
            <input
              id={`${id}-city`}
              type="text"
              disabled={readOnly}
              className={cn(inputAmberClass, errors.city && 'border-destructive focus:ring-destructive/20')}
              {...register('city')}
            />
            {errors.city && <p className={errorClass}>{errors.city.message}</p>}
          </div>

          <div data-tour-step="8" className="sm:col-span-4 relative scroll-mt-28">
            <label htmlFor={`${id}-state-code`} className={labelClass}>
              <Globe className="size-3.5 text-amber-800 shrink-0" />
              <span>State <span className="text-destructive">*</span></span>
            </label>
            <select
              id={`${id}-state-code`}
              disabled={readOnly}
              tabIndex={identityLocked ? -1 : undefined}
              aria-readonly={identityLocked ? 'true' : undefined}
              className={cn(
                inputAmberClass,
                identityLocked && 'pointer-events-none bg-slate-50 text-slate-500',
                errors.state_code && 'border-destructive focus:ring-destructive/20'
              )}
              {...register('state_code')}
            >
              <option value="">Select State</option>
              {INDIAN_GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </select>
            {errors.state_code && <p className={errorClass}>{errors.state_code.message}</p>}
          </div>

          <div data-tour-step="9" className="sm:col-span-3 relative scroll-mt-28">
            <label htmlFor={`${id}-pincode`} className={labelClass}>
              <Hash className="size-3.5 text-amber-800 shrink-0" />
              <span>Pincode <span className="text-destructive">*</span></span>
            </label>
            <input
              id={`${id}-pincode`}
              type="text"
              maxLength={6}
              disabled={readOnly}
              className={cn(inputAmberClass, 'font-mono', errors.pincode && 'border-destructive focus:ring-destructive/20')}
              {...register('pincode')}
            />
            {errors.pincode && <p className={errorClass}>{errors.pincode.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface BankDetailsSectionProps {
  id: string;
  register: UseFormRegister<BusinessProfileInput>;
  errors: FieldErrors<BusinessProfileInput>;
  readOnly?: boolean;
}

export function BankDetailsSection({
  id,
  register,
  errors,
  readOnly = false,
}: BankDetailsSectionProps) {
  return (
    <div className={sectionClass}>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between pb-2 border-b border-border/50 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-rose-900 text-[11px] font-black text-white shadow-xs">
            3
          </div>
          <Landmark className="size-4 text-rose-900 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 font-heading tracking-wide uppercase">Bank Details</h3>
        </div>
        <span className="pl-[54px] sm:pl-0 text-xs font-medium text-muted-foreground">For receiving invoice payments</span>
      </div>

      <div className="space-y-3">
        <div className="grid gap-2.5 sm:gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-bank-name`} className={labelClass}>
              <Landmark className="size-3.5 text-rose-900 shrink-0" />
              <span>Bank Name</span>
            </label>
            <input
              id={`${id}-bank-name`}
              type="text"
              disabled={readOnly}
              placeholder="e.g. HDFC Bank"
              className={cn(inputRoseClass, errors.bank_name && 'border-destructive focus:ring-destructive/20')}
              {...register('bank_name')}
            />
            {errors.bank_name && <p className={errorClass}>{errors.bank_name.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-bank-account-name`} className={labelClass}>
              <UserCheck className="size-3.5 text-rose-900 shrink-0" />
              <span>Account Name</span>
            </label>
            <input
              id={`${id}-bank-account-name`}
              type="text"
              disabled={readOnly}
              placeholder="e.g. Acme Traders"
              className={cn(inputRoseClass, errors.bank_account_name && 'border-destructive focus:ring-destructive/20')}
              {...register('bank_account_name')}
            />
            {errors.bank_account_name && <p className={errorClass}>{errors.bank_account_name.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-bank-account-number`} className={labelClass}>
              <CreditCard className="size-3.5 text-rose-900 shrink-0" />
              <span>Account Number</span>
            </label>
            <input
              id={`${id}-bank-account-number`}
              type="text"
              disabled={readOnly}
              className={cn(inputRoseClass, 'font-mono', errors.bank_account_number && 'border-destructive focus:ring-destructive/20')}
              {...register('bank_account_number')}
            />
            {errors.bank_account_number && <p className={errorClass}>{errors.bank_account_number.message}</p>}
          </div>

          <div>
            <label htmlFor={`${id}-bank-ifsc`} className={labelClass}>
              <QrCode className="size-3.5 text-rose-900 shrink-0" />
              <span>IFSC Code</span>
            </label>
            <input
              id={`${id}-bank-ifsc`}
              type="text"
              maxLength={11}
              disabled={readOnly}
              className={cn(inputRoseClass, 'font-mono uppercase tracking-wider', errors.bank_ifsc && 'border-destructive focus:ring-destructive/20')}
              {...register('bank_ifsc')}
            />
            {errors.bank_ifsc && <p className={errorClass}>{errors.bank_ifsc.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
