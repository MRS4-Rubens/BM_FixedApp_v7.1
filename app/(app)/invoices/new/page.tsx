import { InvoiceForm } from '@/components/app/invoices/invoice-form';
import { db } from '@/lib/db/client';
import { taxRates, financialYears } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { redirectReadOnlyRole } from '@/lib/auth/page-guards';
import { getCurrentBusiness } from '@/lib/auth/current-business';
import { loadSignatureDataUri } from '@/lib/storage/signature';

// bounds after()-scheduled PDF archival started by finalize server actions
export const maxDuration = 60;

export default async function NewInvoicePage() {
  const appUser = await getCurrentAppUser();
  if (!appUser?.business_id) {
    redirect('/settings');
  }
  redirectReadOnlyRole(appUser.role, '/invoices');

  const business = await getCurrentBusiness();
  if (!business) {
    redirect('/settings');
  }

  // B3: the three loads are independent, so run them together (was one after another). The signature is cached by key.
  const [activeFys, allTaxRates, signatureDataUri] = await Promise.all([
    db.select().from(financialYears).where(eq(financialYears.business_id, appUser.business_id)),
    db.select().from(taxRates).where(eq(taxRates.is_active, true)),
    business.signature_storage_key ? loadSignatureDataUri(business.signature_storage_key) : Promise.resolve(null),
  ]);

  return (
    <InvoiceForm 
      taxRates={allTaxRates}
      business={business}
      activeFys={activeFys}
      isDraft={false}
      signatureDataUri={signatureDataUri}
    />
  );
}
