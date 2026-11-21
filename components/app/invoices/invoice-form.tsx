'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useForm, useFieldArray, FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { invoiceDraftSchema, type InvoiceDraftInput, type InvoiceLineItemInput } from '@/lib/validations/invoice';
import { getNextSequenceForDate } from '@/lib/actions/invoices/get-next-sequence';
import { formatIstDateAsIso } from '@/lib/invoices/ist-date';
import { canUseTemplate } from '@/lib/subscriptions/entitlements';
import { DeleteDraftButton } from '@/components/app/invoices/delete-draft-button';
import { useIsClient } from '@/lib/hooks/use-is-client';
import { resolveDraftDisplayPrefs } from '@/lib/invoices/display-prefs';
import { stateTaxLabel } from '@/lib/gst/indian-states';
import type { CustomerOption } from '@/lib/pickers/types';
import type { CurrentBusiness } from '@/lib/auth/current-business';
import type { taxRates as taxRatesTable, financialYears as financialYearsTable } from '@/lib/db/schema';

import {
  computeInvoiceTaxPreview,
  buildInvoiceNumberPreview,
  collectValidationErrors,
  buildPreviewInvoiceData,
} from './invoice-form/form-calculations';
import { useCustomerSearch } from './invoice-form/use-customer-search';
import { useProductSuggestions } from './invoice-form/use-product-suggestions';
import { useLineReorder } from './invoice-form/use-line-reorder';
import { useInvoiceSubmit } from './invoice-form/use-invoice-submit';
import { InvoiceDetailsCard } from './invoice-form/invoice-details-card';
import { CustomerDetailsCard } from './invoice-form/customer-details-card';
import { LineItemsTable } from './invoice-form/line-items-table';
import { InternalNotesCard } from './invoice-form/internal-notes-card';
import { GstBreakdownCard } from './invoice-form/gst-breakdown-card';
import { TotalsSummaryCard } from './invoice-form/totals-summary-card';
import { InvoicePreviewModal } from './invoice-form/invoice-preview-modal-lazy';
import { FinalizeDialogs } from './invoice-form/finalize-dialogs';
import { useUnsavedInvoiceDraft } from './invoice-form/use-unsaved-invoice-draft';
import { UnsavedDraftNotice } from './invoice-form/unsaved-draft-notice';

/**
 * DEBT-001: a saved draft line can hold a unit that is no longer in UNIT_OF_MEASUREMENT_OPTIONS (the DB column is free
 * text; legacy rows may say e.g. "KG"). It is passed through UNCHANGED so the form's zod validation stops the save and
 * the user picks a valid unit — never silently rewritten to another unit.
 */
export type InvoiceFormInitialLine = Omit<InvoiceLineItemInput, 'unit_of_measurement'> & { unit_of_measurement: string };
export type InvoiceFormInitialData = Omit<Partial<InvoiceDraftInput>, 'line_items'> & {
  id?: string;
  line_items?: InvoiceFormInitialLine[];
};

export function InvoiceForm({
  initialData, initialCustomer, taxRates, business, activeFys, isDraft, signatureDataUri,
}: {
  initialData?: InvoiceFormInitialData;
  initialCustomer?: CustomerOption | null;
  taxRates: Array<typeof taxRatesTable.$inferSelect>;
  business: CurrentBusiness;
  activeFys: Array<typeof financialYearsTable.$inferSelect>;
  isDraft: boolean;
  signatureDataUri?: string | null;
}) {
  const [previewSequence, setPreviewSequence] = useState<number | null>(null);
  const [showTemplateUpgradeModal, setShowTemplateUpgradeModal] = useState(false);

  // Preview and verification states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewVerified, setIsPreviewVerified] = useState(false);
  const [showPreviewWarning, setShowPreviewWarning] = useState(false);
  const [previewPrintSize, setPreviewPrintSize] = useState<'A4' | 'A5'>('A5');

  const mounted = useIsClient();
  const displayPrefs = useMemo(() => resolveDraftDisplayPrefs(business?.invoice_display_prefs), [business?.invoice_display_prefs]);
  const taxLabel = stateTaxLabel(business?.state_code);

  // A legacy unit from initialData may sit outside the enum until the user fixes it; invoiceDraftSchema validates on save.
  const defaultValues = {
    customer_id: '',
    billing_name: '',
    billing_gstin: '',
    place_of_supply_state_code: business.state_code,
    invoice_date: formatIstDateAsIso(new Date()),
    notes: '',
    invoice_template: canUseTemplate(business, initialData?.invoice_template || business?.default_invoice_template).allowed
      ? (initialData?.invoice_template || business?.default_invoice_template || 'template_1')
      : 'template_1',
    // Default GST rate type selection (inclusive vs exclusive) inherited from business profile settings
    gst_rate_type: business.default_gst_rate_type === 'inclusive' ? 'inclusive' : 'exclusive',
    line_items: [{ product_id: '', description: '', hsn_sac_code: '', quantity: 1, unit_of_measurement: 'NOS', unit_price: 0, discount: 0, tax_rate_id: '' }],
    ...initialData,
  } as InvoiceDraftInput;

  const methods = useForm<InvoiceDraftInput>({
    resolver: zodResolver(invoiceDraftSchema as never),
    defaultValues,
  });

  const { register, control, setValue, getValues, formState: { errors } } = methods;

  const sortedTaxRates = useMemo(
    () => [...taxRates].sort((a, b) => Number(a.rate_percentage) - Number(b.rate_percentage)),
    [taxRates]
  );

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'line_items',
  });

  const lineItems = useWatch({ control, name: 'line_items' }) || [];
  const invoiceDateVal = useWatch({ control, name: 'invoice_date' }) || '';
  const billingNameVal = useWatch({ control, name: 'billing_name' }) || '';
  const placeOfSupplyStateCodeVal = useWatch({ control, name: 'place_of_supply_state_code' }) || business.state_code;
  const gstRateTypeVal = useWatch({ control, name: 'gst_rate_type' }) || 'exclusive';
  const watchTemplate = useWatch({ control, name: 'invoice_template' }) || 'template_1';
  const watchBillingGstin = useWatch({ control, name: 'billing_gstin' }) || '';

  const {
    selectedCustomer, setSelectedCustomer, customerOptions, isSuggestionsOpen,
    setIsSuggestionsOpen, handleSelectCustomer, handleNameChange,
  } = useCustomerSearch({ billingNameVal, setValue, initialCustomer });

  // New invoice only: unsaved copy kept in this browser (back-swipe / reload safety).
  const unsaved = useUnsavedInvoiceDraft({ enabled: !initialData, businessId: business.id, methods, defaultValues, selectedCustomer, setSelectedCustomer });

  const {
    suggestIdx, isProdSuggestionsOpen,
    setIsProdSuggestionsOpen, activeInputRect, updateInputRect,
    productOptions, handleSelectProduct, handleDescChange, handleDescFocus,
  } = useProductSuggestions({ setValue, lineItems });

  const {
    draggedIdx,
    dropTargetIdx,
    dropPosition,
    touchDraggingIdx,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleMoveLine,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleGroupByGst,
  } = useLineReorder({
    fieldsLength: fields.length,
    move,
    setValue,
    getValues,
    taxRates,
    onBeforeDrag: () => {
      setIsProdSuggestionsOpen(false);
      updateInputRect(null);
    },
  });

  const {
    isFinalizing,
    globalError,
    setGlobalError,
    showQuotaUpgradeModal,
    setShowQuotaUpgradeModal,
    showFinalizeDialog,
    setShowFinalizeDialog,
    showCrossFyDialog,
    setShowCrossFyDialog,
    crossFyErrorMessage,
    onSaveDraft,
    onFinalizeClick,
    executeFinalize,
  } = useInvoiceSubmit({ isPreviewVerified, setShowPreviewWarning, onDraftSaved: unsaved.markSavedToServer });

  // Fetch sequence value dynamically from DB when date changes
  useEffect(() => {
    if (!invoiceDateVal) return;
    let active = true;

    async function fetchSequence() {
      try {
        const res = await getNextSequenceForDate({ dateStr: invoiceDateVal });
        if (active && res.success && res.data) {
          setPreviewSequence(res.data.nextSequence);
        }
      } catch (e) {
        console.error('Failed to load dynamic sequence preview:', e);
      }
    }

    fetchSequence();

    return () => {
      active = false;
    };
  }, [invoiceDateVal]);

  const invoiceNumberFormatPreview = buildInvoiceNumberPreview({
    business,
    invoiceDate: invoiceDateVal,
    activeFys,
    previewSequence,
  });

  const {
    taxResult,
    supplyType,
    totalTaxable,
    totalCGST,
    totalSGST,
    totalIGST,
    roundOff,
    grandTotal,
    gstBreakdownMap,
    sortedGstRates,
  } = computeInvoiceTaxPreview({
    lineItems,
    taxRates,
    sellerStateCode: business.state_code,
    placeOfSupplyStateCode: placeOfSupplyStateCodeVal,
    gstRateType: gstRateTypeVal,
  });

  const validationErrors = collectValidationErrors(errors);

  const previewInvoiceData = buildPreviewInvoiceData({
    initialId: initialData?.id,
    business,
    watchLineItems: lineItems,
    watchPlaceOfSupplyState: placeOfSupplyStateCodeVal,
    watchBillingName: billingNameVal,
    watchBillingGstin,
    watchInvoiceDate: invoiceDateVal,
    watchTemplate,
    gstRateTypeVal,
    taxRates,
    selectedCustomer,
    invoiceNumberFormatPreview,
    signatureDataUri,
  });

  return (
    <FormProvider {...methods}>
      <div className="space-y-4">
        <div className="space-y-3.5 print:hidden">
          <div className="flex items-center gap-3">
            <Link href="/invoices" aria-label="Back to invoices" className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-sm shrink-0">
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="text-2xl font-bold tracking-tight font-heading text-foreground whitespace-nowrap">{isDraft ? 'Edit Draft Invoice' : 'New Invoice'}</h1>
            {isDraft && initialData?.id ? (
              <div className="ml-auto">
                <DeleteDraftButton invoiceId={initialData.id} variant="button" redirectTo="/invoices" onError={setGlobalError} />
              </div>
            ) : null}
          </div>

          {unsaved.restoredAt !== null && <UnsavedDraftNotice restoredAt={unsaved.restoredAt} onDiscard={unsaved.discard} onDismiss={unsaved.dismissNotice} />}
          {globalError && (
            <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium animate-shake">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div>{globalError}</div>
            </div>
          )}
          {validationErrors.length > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium animate-shake">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <div className="font-bold text-xs uppercase tracking-wider">Please resolve the following validation issues:</div>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {validationErrors.map((err, idx) => (
                    <li key={idx} className="leading-relaxed font-semibold">{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <form className="flex flex-col gap-3.5">
            {/* Hidden calculation mode input registered in Hook Form */}
            <input type="hidden" {...register('gst_rate_type')} />
            <div className="grid gap-3.5 lg:grid-cols-12">
              <InvoiceDetailsCard
                invoiceNumberFormatPreview={invoiceNumberFormatPreview}
                showPreviewWarning={showPreviewWarning}
                setIsPreviewOpen={setIsPreviewOpen}
                setShowPreviewWarning={setShowPreviewWarning}
              />
              <CustomerDetailsCard
                selectedCustomer={selectedCustomer}
                customerOptions={customerOptions}
                isSuggestionsOpen={isSuggestionsOpen}
                billingNameVal={billingNameVal}
                placeOfSupplyStateCodeVal={placeOfSupplyStateCodeVal}
                setIsSuggestionsOpen={setIsSuggestionsOpen}
                handleSelectCustomer={handleSelectCustomer}
                handleNameChange={handleNameChange}
              />
            </div>

            <LineItemsTable
              fields={fields}
              append={append}
              remove={remove}
              handleMoveLine={handleMoveLine}
              handleGroupByGst={handleGroupByGst}
              taxRates={taxRates}
              sortedTaxRates={sortedTaxRates}
              gstRateTypeVal={gstRateTypeVal}
              displayPrefs={displayPrefs}
              mounted={mounted}
              draggedIdx={draggedIdx}
              dropTargetIdx={dropTargetIdx}
              dropPosition={dropPosition}
              touchDraggingIdx={touchDraggingIdx}
              handleDragStart={handleDragStart}
              handleDragOver={handleDragOver}
              handleDragLeave={handleDragLeave}
              handleDrop={handleDrop}
              handleDragEnd={handleDragEnd}
              handleTouchStart={handleTouchStart}
              handleTouchMove={handleTouchMove}
              handleTouchEnd={handleTouchEnd}
              suggestIdx={suggestIdx}
              isProdSuggestionsOpen={isProdSuggestionsOpen}
              setIsProdSuggestionsOpen={setIsProdSuggestionsOpen}
              activeInputRect={activeInputRect}
              updateInputRect={updateInputRect}
              productOptions={productOptions}
              handleSelectProduct={handleSelectProduct}
              handleDescChange={handleDescChange}
              handleDescFocus={handleDescFocus}
            />

            <div className="grid gap-3.5 lg:grid-cols-[1fr_1.3fr_1fr]">
              <InternalNotesCard />
              <GstBreakdownCard
                sortedGstRates={sortedGstRates}
                gstBreakdownMap={gstBreakdownMap}
                totalTaxable={totalTaxable}
                taxResult={taxResult}
                taxLabel={taxLabel}
              />
              <TotalsSummaryCard
                supplyType={supplyType}
                totalTaxable={totalTaxable}
                totalCGST={totalCGST}
                totalSGST={totalSGST}
                totalIGST={totalIGST}
                roundOff={roundOff}
                grandTotal={grandTotal}
                isFinalizing={isFinalizing}
                onSaveDraft={onSaveDraft}
                onFinalizeClick={onFinalizeClick}
                taxLabel={taxLabel}
              />
            </div>
          </form>
        </div>

        {(isPreviewOpen || showTemplateUpgradeModal) && (
        <InvoicePreviewModal
          mounted={mounted}
          isPreviewOpen={isPreviewOpen}
          setIsPreviewOpen={setIsPreviewOpen}
          previewInvoiceData={previewInvoiceData}
          business={business}
          displayPrefs={displayPrefs}
          watchTemplate={watchTemplate}
          previewPrintSize={previewPrintSize}
          setPreviewPrintSize={setPreviewPrintSize}
          isPreviewVerified={isPreviewVerified}
          setIsPreviewVerified={setIsPreviewVerified}
          setShowPreviewWarning={setShowPreviewWarning}
          showTemplateUpgradeModal={showTemplateUpgradeModal}
          setShowTemplateUpgradeModal={setShowTemplateUpgradeModal}
          setValue={setValue}
        />
        )}

        <FinalizeDialogs
          showQuotaUpgradeModal={showQuotaUpgradeModal}
          setShowQuotaUpgradeModal={setShowQuotaUpgradeModal}
          showFinalizeDialog={showFinalizeDialog}
          setShowFinalizeDialog={setShowFinalizeDialog}
          showCrossFyDialog={showCrossFyDialog}
          setShowCrossFyDialog={setShowCrossFyDialog}
          crossFyErrorMessage={crossFyErrorMessage}
          invoiceNumberFormatPreview={invoiceNumberFormatPreview}
          invoiceDateVal={invoiceDateVal}
          billingNameVal={billingNameVal}
          grandTotal={grandTotal}
          executeFinalize={executeFinalize}
        />
      </div>
    </FormProvider>
  );
}
