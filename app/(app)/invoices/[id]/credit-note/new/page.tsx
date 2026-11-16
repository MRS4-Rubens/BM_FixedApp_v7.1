import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/auth/session';
import { redirectReadOnlyRole } from '@/lib/auth/page-guards';
import { getCreditNoteFormData } from '@/lib/actions/credit-notes/get-credit-note-form-data';
import { CreditNoteForm } from '@/components/app/credit-notes/credit-note-form';

// bounds after()-scheduled PDF archival started by finalize server actions
export const maxDuration = 60;

export default async function NewCreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Feature B: the read-only accountant cannot issue credit notes; send them back to the invoice.
  const appUser = await getCurrentAppUser();
  redirectReadOnlyRole(appUser.role, `/invoices/${id}`);

  const result = await getCreditNoteFormData({ invoiceId: id });

  if (!result.success) {
    if (result.error.code === 'UNAUTHORIZED') {
      redirect('/login');
    }
    return (
      <div className="space-y-4">
        <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm font-medium">
          <strong className="font-bold">Cannot Issue Credit Note:</strong> {result.error.message}
        </div>
      </div>
    );
  }

  const {
    invoice,
    previouslyCreditedPaise,
    previouslyCreditedExactPaise,
    invoiceExactTotalPaise,
    business,
    lineStates,
  } = result.data;

  return (
    <CreditNoteForm
      originalInvoice={invoice}
      previouslyCreditedPaise={previouslyCreditedPaise}
      previouslyCreditedExactPaise={previouslyCreditedExactPaise}
      invoiceExactTotalPaise={invoiceExactTotalPaise}
      business={business}
      initialLineStates={lineStates}
    />
  );
}
