import { InvoiceForm } from '@/components/app/invoices/invoice-form';
import { db } from '@/lib/db/client';
import { taxRates, financialYears } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { getCurrentBusiness } from '@/lib/auth/current-business';

// bounds after()-scheduled PDF archival started by finalize server actions
export const maxDuration = 60;

export default async function NewInvoicePage() {
  const appUser = await getCurrentAppUser();
  if (!appUser?.business_id) {
    redirect('/settings');
  }

  const business = await getCurrentBusiness();
  if (!business) {
    redirect('/settings');
  }

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
