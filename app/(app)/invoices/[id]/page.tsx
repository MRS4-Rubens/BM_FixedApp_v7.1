import { getInvoice } from '@/lib/actions/invoices/get-invoice';
import { InvoiceForm } from '@/components/app/invoices/invoice-form';
import { InvoiceDetail } from '@/components/app/invoices/invoice-detail';
import { db } from '@/lib/db/client';
import { businesses, customers, taxRates, financialYears } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { listPayments, type PaymentListItem } from '@/lib/actions/payments/list-payments';
import { listCreditNotes, type CreditNoteListItem } from '@/lib/actions/credit-notes/list-credit-notes';
import { resolveSellerDetails, toInvoicePrintFields, type SellerDetails } from '@/lib/invoices/seller-snapshot';
import { resolveFinalizedDisplayPrefs } from '@/lib/invoices/display-prefs';
import { buildLogoUrl } from '@/lib/storage/logo-url';
import type { CustomerOption } from '@/lib/pickers/types';

// bounds after()-scheduled PDF archival started by finalize server actions
export const maxDuration = 60;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  const result = await getInvoice({ id });
  if (!result.success) {
    const { code } = result.error;
    // createAuthenticatedAction reports a missing session/app user as NO_APP_USER.
    if (code === 'NO_APP_USER') redirect('/login');
    if (code === 'NO_BUSINESS') redirect('/settings');
    // Missing, another business's invoice, or a malformed id: the branded 404 (and noindex), never a hint that
    // the id exists.
    if (code === 'NOT_FOUND' || code === 'VALIDATION_ERROR') notFound();
    // Anything else is unexpected: let the route error boundary handle it instead of mislabelling it "not found".
    throw new Error('Failed to load invoice.');
  }
  
  const invoice = result.data;
  const appUser = await getCurrentAppUser();
  if (!appUser?.business_id) redirect('/settings');

  const businessResult = await db.select().from(businesses).where(eq(businesses.id, appUser.business_id));
  const business = businessResult[0];

  if (invoice?.lifecycle_status === 'draft') {
    let initialCustomer: CustomerOption | null = null;
    if (invoice.customer_id) {
      const [cRow] = await db
        .select({
          id: customers.id,
          name: customers.name,
          gstin: customers.gstin,
          state_code: customers.state_code,
          address_line1: customers.address_line1,
          address_line2: customers.address_line2,
          city: customers.city,
          pincode: customers.pincode,
          phone: customers.phone,
        })
        .from(customers)
        .where(
          and(
            eq(customers.id, invoice.customer_id),
            eq(customers.business_id, appUser.business_id),
          ),
        )
        .limit(1);
      if (cRow) {
        initialCustomer = cRow;
      }
    }
    const allTaxRates = await db.select().from(taxRates).where(eq(taxRates.is_active, true));
    const activeFys = await db.select().from(financialYears).where(eq(financialYears.business_id, appUser.business_id));

    // Convert line items to Draft Input Format
    const initialData = {
      id: invoice.id,
      customer_id: invoice.customer_id || '',
      billing_name: invoice.billing_name_snapshot || '',
      billing_gstin: invoice.billing_gstin_snapshot || '',
      place_of_supply_state_code: invoice.place_of_supply_state_code || business.state_code,
      notes: invoice.notes || '',
      invoice_template: invoice.invoice_template || 'template_1',
      line_items: invoice.lineItems.map(li => ({
        product_id: li.product_id || '',
        description: li.description,
        hsn_sac_code: li.hsn_sac_code,
        quantity: Number(li.quantity),
        unit_of_measurement: li.unit_of_measurement,
        unit_price: li.unit_price_paise / 100,
        discount: (() => {
          const qty = Number(li.quantity) || 0;
          const grossPaise = Math.round(qty * li.unit_price_paise);
          return grossPaise > 0 ? Math.round((li.discount_paise / grossPaise) * 100) : 0;
        })(),
        tax_rate_id: allTaxRates.find(tr => Number(tr.rate_percentage) === Number(li.tax_rate_percentage))?.id || allTaxRates[0]?.id
      }))
    };

    return (
      <InvoiceForm 
        initialData={initialData}
        initialCustomer={initialCustomer}
        taxRates={allTaxRates}
        business={business}
        activeFys={activeFys}
        isDraft={true}
      />
    );
  }

  // Finalized
  let seller: SellerDetails;
  try {
    seller = resolveSellerDetails(invoice, null);
  } catch {
    return (
      <div className="p-4 text-destructive">
        The seller snapshot for this finalized invoice is missing or corrupt.
      </div>
    );
  }

  let payments: PaymentListItem[] = [];
  let creditNotesList: readonly CreditNoteListItem[] = [];
  if (invoice?.lifecycle_status === 'finalized') {
    const [pResult, cnResult] = await Promise.all([
      listPayments({ invoice_id: id }),
      listCreditNotes({ invoice_id: id })
    ]);
    if (pResult.success) payments = pResult.data;
    if (cnResult.success) creditNotesList = cnResult.data.items;
  }

  const displayPrefs = resolveFinalizedDisplayPrefs(invoice?.display_prefs_snapshot);

  return (
    <InvoiceDetail 
      displayPrefs={displayPrefs}
      invoice={{
        ...invoice, 
        ...toInvoicePrintFields(seller),
        logo_url: seller.logoStorageKey ? buildLogoUrl(invoice.business_id, seller.logoStorageKey) : null,
        customer_email: invoice.customer?.email,
        customer_phone: invoice.customer?.phone,
        upi_id: ((business as Record<string, unknown>).upi_id as string) || null,
        subscription_plan: business.subscription_plan,
        subscription_status: business.subscription_status,
        trial_ends_at: business.trial_ends_at,
      }} 
      payments={payments} 
      creditNotes={creditNotesList}
      businessStateCode={seller.stateCode}
      business={business}
    />
  );
}
