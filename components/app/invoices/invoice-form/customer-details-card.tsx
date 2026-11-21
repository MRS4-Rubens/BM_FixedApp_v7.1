'use client';

import { useFormContext, useWatch } from 'react-hook-form';
import { ChevronDown, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import type { InvoiceDraftInput } from '@/lib/validations/invoice';
import type { CustomerOption } from '@/lib/pickers/types';
import { normalizeBuyerGstin } from '@/lib/invoices/buyer-snapshot';

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-all hover:border-muted-foreground/30 shadow-sm";
const labelCls = "mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap";
const sectionTitleCls = "flex items-center gap-2 mb-2 pb-1.5 border-b border-border";

export function CustomerDetailsCard({
  selectedCustomer,
  customerOptions,
  isSuggestionsOpen,
  billingNameVal,
  placeOfSupplyStateCodeVal,
  setIsSuggestionsOpen,
  handleSelectCustomer,
  handleNameChange,
}: {
  selectedCustomer: CustomerOption | null;
  customerOptions: CustomerOption[];
  isSuggestionsOpen: boolean;
  billingNameVal: string;
  placeOfSupplyStateCodeVal?: string;
  setIsSuggestionsOpen: (open: boolean) => void;
  handleSelectCustomer: (cust: CustomerOption) => void;
  handleNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { register, control, formState: { errors } } = useFormContext<InvoiceDraftInput>();
  // MONEY-02: the GSTIN typed here is what the finalized invoice uses; say so when it differs from the saved customer.
  const billingGstinVal = useWatch({ control, name: 'billing_gstin' });
  const gstinDiffersFromCustomer =
    selectedCustomer !== null && normalizeBuyerGstin(billingGstinVal) !== normalizeBuyerGstin(selectedCustomer.gstin);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm lg:col-span-5">
      <div className={sectionTitleCls}>
        <User className="size-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground uppercase tracking-wider whitespace-nowrap">Customer Details</span>
      </div>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="customer-name-input" className={labelCls}>Customer Name</label>
          <input
            id="customer-name-input"
            type="text"
            placeholder="Type to search or enter ad-hoc name..."
            className={cn(inputCls, errors.billing_name && 'border-destructive focus:ring-destructive/30 animate-shake')}
            {...register('billing_name')}
            onChange={handleNameChange}
            onFocus={() => setIsSuggestionsOpen(true)}
            onBlur={() => setTimeout(() => setIsSuggestionsOpen(false), 200)}
          />
          {errors.billing_name && <p className="mt-1 text-xs text-destructive font-medium">{errors.billing_name.message}</p>}

          {isSuggestionsOpen && billingNameVal.trim().length > 0 && customerOptions.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover py-1.5 shadow-lg animate-fadeIn text-popover-foreground">
              {customerOptions.map(cust => (
                <button
                  key={cust.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectCustomer(cust)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors font-medium flex justify-between items-center border-b border-border/40 last:border-b-0 cursor-pointer"
                >
                  <span>{cust.name}</span>
                  {cust.gstin && <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{cust.gstin}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="billing-gstin-input" className={labelCls}>GSTIN (Optional)</label>
            <input
              id="billing-gstin-input"
              type="text"
              placeholder="e.g. 29ABCDE1234F1Z5"
              className={cn(inputCls, 'font-mono text-xs uppercase', errors.billing_gstin && 'border-destructive focus:ring-destructive/30 animate-shake')}
              {...register('billing_gstin')}
            />
            {errors.billing_gstin && <p className="mt-1 text-xs text-destructive font-medium">{errors.billing_gstin.message}</p>}
            {!errors.billing_gstin && gstinDiffersFromCustomer ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedCustomer?.gstin ? `Saved customer's GSTIN is ${selectedCustomer.gstin}.` : 'The saved customer has no GSTIN.'} This invoice will use the GSTIN entered here.
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="place-of-supply-input" className={labelCls}>Place of Supply State</label>
            <div className="relative">
              <select
                id="place-of-supply-input"
                aria-label="Place of supply state"
                className={cn(inputCls, 'appearance-none pr-9', errors.place_of_supply_state_code && 'border-destructive focus:ring-destructive/30 animate-shake')}
                {...register('place_of_supply_state_code')}
              >
                {INDIAN_GST_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code} - {s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none size-4 text-muted-foreground" />
            </div>
            {errors.place_of_supply_state_code && <p className="mt-1 text-xs text-destructive font-medium">{errors.place_of_supply_state_code.message}</p>}
            {selectedCustomer && selectedCustomer.state_code && placeOfSupplyStateCodeVal && selectedCustomer.state_code !== placeOfSupplyStateCodeVal ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Customer is registered in {INDIAN_GST_STATES.find((s) => s.code === selectedCustomer.state_code)?.name ?? selectedCustomer.state_code}. Tax is calculated for the delivery state selected here.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

