'use server';

import { createAuthenticatedAction } from '@/lib/actions/_shared/create-action';
import { EDITOR_ROLES } from '@/lib/auth/rbac';
import { toThrowable } from '@/lib/actions/_shared/action-error-mapping';
import { ActionError } from '@/lib/actions/_shared/errors';
import { assertOwnedCustomer, assertOwnedProducts } from '@/lib/actions/_shared/ownership';
import { roundToRupeePaise } from '@/lib/money';
import { invoiceDraftSchema } from '@/lib/validations/invoice';
import { db } from '@/lib/db/client';
import { invoices, invoiceLineItems, businesses, taxRates } from '@/lib/db/schema';
import { calculateInvoiceTax } from '@/lib/gst/calculate';
import { GstCalculationError } from '@/lib/gst/errors';
import { TaxCalculationInput, TaxCalculationResult, TaxLineItemInput } from '@/lib/gst/types';
import { isTaxRateEffectiveOn } from '@/lib/gst/tax-rate-validity';
import { buildTaxLineInput, assertTaxResultWithinCeiling, LineMathError } from '@/lib/invoices/line-math';
import { eq, inArray, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { lockDraftInvoice } from '@/lib/invoices/document-locks';
import { getOrCreateCurrentFinancialYear } from '@/lib/invoices/financial-year-rollover';
import { formatIstDateAsIso, parseIsoDateToIstDate } from '@/lib/invoices/ist-date';
import { canUseTemplate } from '@/lib/subscriptions/entitlements';

function toCalculationActionError(error: unknown): ActionError | null {
  if (error instanceof ActionError) return error;
  if (error instanceof LineMathError || error instanceof GstCalculationError) {
    return new ActionError(error.message, {
      code:
        error instanceof LineMathError && error.code === 'DOCUMENT_TOTAL_TOO_LARGE'
          ? 'AMOUNT_TOO_LARGE'
          : 'CALCULATION_ERROR',
    });
  }
  return null;
}

/** invoice_line_items.quantity is numeric(10,3): calculate with exactly what is stored (COMP-003). */
function toStoredQuantity(quantity: number): number {
  return Number(quantity.toFixed(3));
}

export const saveInvoiceDraft = createAuthenticatedAction(invoiceDraftSchema, async (input, context) => {
  const businessId = context.appUser.business_id;
  if (!businessId) {
    throw new ActionError('Your account is not linked to a business profile.', { code: 'NO_BUSINESS_LINKED' });
  }

  try {
    return await db.transaction(async (tx) => {
      // 1. Check if updating existing
      if (input.id) {
        await lockDraftInvoice(
          tx,
          { id: input.id, businessId },
          { alreadyFinalized: 'This invoice has already been finalized and cannot be edited. Issue a credit note instead.' },
        );
      }

      // Fetch business
      const [business] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
      if (!business) throw new ActionError('Business not found.', { code: 'NOT_FOUND' });

      // Ownership checks for customer and any selected products (fail fast before tax/insert)
      if (input.customer_id) {
        await assertOwnedCustomer(tx, businessId, input.customer_id);
      }
      const referencedProductIds = input.line_items
        .map((li) => li.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      await assertOwnedProducts(tx, businessId, referencedProductIds);

      // 2. Fetch business defaults if needed
      const businessStateCode = business.state_code;
      const defaultTemplate = business.default_invoice_template || 'classic';

      if (!businessStateCode) {
        throw new ActionError('Please set your registered state in Settings before creating invoices.', {
          code: 'BUSINESS_STATE_MISSING',
        });
      }

      // Template Entitlement Check
      const targetTemplate = input.invoice_template || defaultTemplate;
      const templateCheck = canUseTemplate(business, targetTemplate);
      if (!templateCheck.allowed) {
        throw new ActionError(templateCheck.reason || 'Selected template requires Essentials Pro.', {
          code: templateCheck.code || 'TEMPLATE_LOCKED',
        });
      }

      const placeOfSupplyStateCode = input.place_of_supply_state_code;

      const taxRateIds = input.line_items.map((li) => li.tax_rate_id);
      const referenceIso = input.invoice_date ?? formatIstDateAsIso(new Date());
      const fetchedTaxRates = await tx
        .select({
          id: taxRates.id,
          rate_percentage: taxRates.rate_percentage,
          is_active: taxRates.is_active,
          effective_from: taxRates.effective_from,
          effective_to: taxRates.effective_to,
        })
        .from(taxRates)
        .where(inArray(taxRates.id, taxRateIds));
      const taxRateMap = new Map(
        fetchedTaxRates
          .filter((rate) => isTaxRateEffectiveOn(rate, referenceIso))
          .map((rate) => [rate.id, Number(rate.rate_percentage)] as const),
      );

      // 3. Prepare Tax Calculation Input & Validate Calculations
      let taxLineItemInputs: TaxLineItemInput[];
      let taxResult: TaxCalculationResult;
      try {
        taxLineItemInputs = input.line_items.map((li) => {
          const ratePct = taxRateMap.get(li.tax_rate_id);
          if (ratePct === undefined) {
            throw new ActionError(
              'One or more selected GST rates are inactive or not valid on the invoice date. Please re-select the GST rate on your line items.',
              { code: 'INVALID_TAX_RATE' },
            );
          }
          return buildTaxLineInput({
            quantity: toStoredQuantity(li.quantity),
            unitPriceRupees: li.unit_price,
            discountPercent: li.discount,
            taxRatePercentage: ratePct,
          });
        });

        const taxCalcInput: TaxCalculationInput = {
          sellerStateCode: businessStateCode,
          placeOfSupplyStateCode: placeOfSupplyStateCode,
          lineItems: taxLineItemInputs,
          gstRateType: input.gst_rate_type || 'exclusive',
        };

        taxResult = calculateInvoiceTax(taxCalcInput);
        assertTaxResultWithinCeiling(taxResult);
      } catch (error: unknown) {
        const actionError = toCalculationActionError(error);
        if (actionError !== null) throw actionError;
        throw error;
      }

      // 5. Create or Update Invoice
      let invoiceId = input.id;

      const invoiceData = {
        business_id: businessId,
        customer_id: input.customer_id || null,
        invoice_date: input.invoice_date || null,
        notes: input.notes || null,
        lifecycle_status: 'draft' as const,
        subtotal_paise: taxResult.subtotalPaise,
        total_cgst_paise: taxResult.totalCgstPaise,
        total_sgst_paise: taxResult.totalSgstPaise,
        total_igst_paise: taxResult.totalIgstPaise,
        total_tax_paise: taxResult.totalTaxPaise,
        grand_total_paise: roundToRupeePaise(taxResult.grandTotalPaise),
        billing_name_snapshot: input.billing_name,
        billing_gstin_snapshot: input.billing_gstin || null,
        place_of_supply_state_code: input.place_of_supply_state_code,
        invoice_template: input.invoice_template || defaultTemplate,
        gst_rate_type: input.gst_rate_type || 'exclusive',
      };

      const referenceDate = input.invoice_date ? parseIsoDateToIstDate(input.invoice_date) : new Date();
      const activeFy = await getOrCreateCurrentFinancialYear(tx, businessId, referenceDate);

      if (!invoiceId) {
        const [newInv] = await tx.insert(invoices).values({
          ...invoiceData,
          financial_year_id: activeFy.id,
          invoice_sequence: null,
          invoice_number: `DRAFT-${Date.now()}`,
        }).returning({ id: invoices.id });
        invoiceId = newInv.id;
      } else {
        const updated = await tx
          .update(invoices)
          .set({
            ...invoiceData,
            financial_year_id: activeFy.id,
            // Record every draft save (line items are replaced below); finalized rows are never matched here.
            updated_at: new Date(),
          })
          .where(
            and(
              eq(invoices.id, invoiceId),
              eq(invoices.business_id, businessId),
              eq(invoices.lifecycle_status, 'draft'),
            ),
          )
          .returning({ id: invoices.id });

        if (updated.length !== 1) {
          throw new ActionError(
            'This invoice has already been finalized and cannot be edited. Issue a credit note instead.',
            { code: 'ALREADY_FINALIZED' },
          );
        }
      }

      // 6. Replace Line Items
      if (input.id) {
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoice_id, invoiceId));
      }

      const insertItems = input.line_items.map((li, idx) => {
        const calcLi = taxResult.lineItems[idx];
        return {
          invoice_id: invoiceId as string,
          product_id: li.product_id || null,
          description: li.description,
          hsn_sac_code: li.hsn_sac_code,
          quantity: toStoredQuantity(li.quantity).toFixed(3),
          unit_of_measurement: li.unit_of_measurement,
          unit_price_paise: taxLineItemInputs[idx].unitPricePaise,
          discount_paise: calcLi.discountPaise,
          taxable_value_paise: calcLi.taxableValuePaise,
          tax_rate_percentage: calcLi.taxRatePercentage.toString(),
          cgst_paise: calcLi.cgstPaise,
          sgst_paise: calcLi.sgstPaise,
          igst_paise: calcLi.igstPaise,
          line_total_paise: calcLi.lineTotalPaise,
          sort_order: idx,
        };
      });

      await tx.insert(invoiceLineItems).values(insertItems);

      revalidatePath('/invoices');
      revalidatePath(`/invoices/${invoiceId}`);

      return { invoiceId };
    });
  } catch (error: unknown) {
    throw toThrowable(error);
  }
}, 'save-invoice-draft', { roles: EDITOR_ROLES, requireActiveSubscription: true });
