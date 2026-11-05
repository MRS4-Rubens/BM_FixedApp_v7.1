import { InvoiceForm } from '@/components/app/invoices/invoice-form';
import { db } from '@/lib/db/client';
import { businesses, taxRates, financialYears } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';

// bounds after()-scheduled PDF archival started by finalize server actions
export const maxDuration = 60;

export default async function NewInvoicePage() {
  const appUser = await getCurrentAppUser();
  if (!appUser?.business_id) {
    redirect('/settings');
  }

  const businessResult = await db.select().from(businesses).where(eq(businesses.id, appUser.business_id));
  const business = businessResult[0];

  const activeFys = await db.select().from(financialYears).where(eq(financialYears.business_id, appUser.business_id));
  const allTaxRates = await db.select().from(taxRates).where(eq(taxRates.is_active, true));

  return (
    <InvoiceForm 
      taxRates={allTaxRates}
      business={business}
      activeFys={activeFys}
      isDraft={false}
    />
  );
}
