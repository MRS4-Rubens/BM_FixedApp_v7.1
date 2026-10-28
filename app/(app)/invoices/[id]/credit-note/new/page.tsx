import { redirect } from 'next/navigation';
import { getCreditNoteFormData } from '@/lib/actions/credit-notes/get-credit-note-form-data';
import { CreditNoteForm } from '@/components/app/credit-notes/credit-note-form';

export default async function NewCreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
