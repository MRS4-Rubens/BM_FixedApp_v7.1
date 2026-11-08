'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle, CornerDownRight, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { finalizeCreditNote } from '@/lib/actions/credit-notes/finalize-credit-note';
import { saveCreditNoteDraft } from '@/lib/actions/credit-notes/save-credit-note-draft';
import {
  CreditNoteRuleError,
  deriveCreditLines,
  milliToQuantity,
  quantityToMilli,
  resolveCreditNoteGrandTotal,
  sumDerivedLines,
  type CreditLineState,
  type CreditNoteTotals,
  type DerivedCreditLine,
} from '@/lib/credit-notes/derivation';
import { formatPaiseAsInr } from '@/lib/money';
import { computeNetBillPaise } from '@/lib/invoices/settlement';
import { CREDIT_NOTE_REASONS, type CreditNoteReasonCode } from '@/lib/validations/credit-note';
import { formatIstDate } from '@/lib/invoices/ist-date';

export interface OriginalInvoiceInfo {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  customer_name: string;
  recipient_gstin: string | null;
  place_of_supply_state_code: string;
  supplier_state_code: string;
  gst_rate_type: 'inclusive' | 'exclusive';
  grand_total_paise: number;
  billing_name?: string | null;
  billing_gstin?: string | null;
}

interface CreditNoteFormProps {
  originalInvoice: OriginalInvoiceInfo;
  previouslyCreditedPaise?: number;
  previouslyCreditedExactPaise?: number;
  invoiceExactTotalPaise: number;
  business: {
    id: string;
    legal_name: string;
    gstin: string;
    state_code: string;
  };
  initialLineStates: CreditLineState[];
  existingCreditNoteId?: string;
  initialReason?: CreditNoteReasonCode;
  initialNotes?: string;
}

type Preview =
  | { ok: true; lines: DerivedCreditLine[]; totals: CreditNoteTotals; grandTotalPaise: number }
  | { ok: false; message: string | null };

export function CreditNoteForm({
  originalInvoice,
  previouslyCreditedPaise = 0,
  previouslyCreditedExactPaise = 0,
  invoiceExactTotalPaise,
  business,
  initialLineStates,
  existingCreditNoteId,
  initialReason = '01-sales-return',
  initialNotes = '',
}: CreditNoteFormProps) {
  const router = useRouter();
  const [reason, setReason] = useState<CreditNoteReasonCode>(initialReason);
  const [notes, setNotes] = useState(initialNotes);

  const [lineStates, setLineStates] = useState<CreditLineState[]>(initialLineStates);
  const remainingMilli = (s: CreditLineState): number =>
    Math.max(0, s.original.quantityMilli - s.credited.quantityMilli);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialLineStates.map((s) => [s.original.originalLineItemId, milliToQuantity(remainingMilli(s))]),
    ),
  );

  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleQuantityChange = (id: string, raw: number): void => {
    const state = lineStates.find((s) => s.original.originalLineItemId === id);
    if (!state) return;
    const bounded = Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, milliToQuantity(remainingMilli(state))));
    setQuantities((prev) => ({ ...prev, [id]: Math.round(bounded * 1000) / 1000 }));
  };

  const handleRemoveItem = (id: string): void => {
    setLineStates((prev) => prev.filter((s) => s.original.originalLineItemId !== id));
  };

  const preview: Preview = useMemo(() => {
    try {
      const requests = lineStates.flatMap((s) => {
        const q = quantities[s.original.originalLineItemId] ?? 0;
        return q > 0
          ? [{ originalLineItemId: s.original.originalLineItemId, quantityMilli: quantityToMilli(q) }]
          : [];
      });
      if (requests.length === 0) return { ok: false, message: null };
      const states = new Map(lineStates.map((s) => [s.original.originalLineItemId, s] as const));
      const lines = deriveCreditLines(states, requests);
      const totals = sumDerivedLines(lines);
      const grandTotalPaise = resolveCreditNoteGrandTotal({
        exactTotalPaise: totals.exactTotalPaise,
        invoiceGrandTotalPaise: originalInvoice.grand_total_paise,
        invoiceExactTotalPaise,
        otherCreditNotesGrandPaise: previouslyCreditedPaise,
        otherCreditNotesExactPaise: previouslyCreditedExactPaise,
      });
      return { ok: true, lines, totals, grandTotalPaise };
    } catch (err: unknown) {
      return {
        ok: false,
        message: err instanceof CreditNoteRuleError ? err.message : 'Unable to calculate this credit note.',
      };
    }
  }, [
    lineStates,
    quantities,
    originalInvoice.grand_total_paise,
    invoiceExactTotalPaise,
    previouslyCreditedPaise,
    previouslyCreditedExactPaise,
  ]);

  const isIntraState =
    (originalInvoice.supplier_state_code || business.state_code) ===
    (originalInvoice.place_of_supply_state_code || business.state_code);

  const subtotalRupees = preview.ok ? preview.totals.subtotalPaise / 100 : 0;
  const cgstRupees = preview.ok ? preview.totals.totalCgstPaise / 100 : 0;
  const sgstRupees = preview.ok ? preview.totals.totalSgstPaise / 100 : 0;
  const igstRupees = preview.ok ? preview.totals.totalIgstPaise / 100 : 0;
  const grandTotalRupees = preview.ok ? preview.grandTotalPaise / 100 : 0;

  const currentCreditPaise = preview.ok ? preview.grandTotalPaise : 0;
  const totalCumulativeCreditedPaise = previouslyCreditedPaise + currentCreditPaise;
  const netAdjustedBalancePaise = computeNetBillPaise(originalInvoice.grand_total_paise, totalCumulativeCreditedPaise);

  const displayedError = errorMessage ?? (preview.ok ? null : preview.message);

  const handleSave = (shouldFinalize: boolean): void => {
    setErrorMessage(null);

    if (!preview.ok) {
      setErrorMessage(preview.message || 'Please specify at least one line item with a quantity greater than 0.');
      return;
    }

    const payloadLines = lineStates
      .filter((s) => (quantities[s.original.originalLineItemId] ?? 0) > 0)
      .map((s) => ({
        original_line_item_id: s.original.originalLineItemId,
        quantity: quantities[s.original.originalLineItemId] ?? 0,
      }));

    if (payloadLines.length === 0) {
      setErrorMessage('Please specify at least one line item with a quantity greater than 0.');
      return;
    }

    startTransition(async () => {
      try {
        const draftRes = await saveCreditNoteDraft({
          id: existingCreditNoteId,
          original_invoice_id: originalInvoice.id,
          reason,
          notes: notes || undefined,
          line_items: payloadLines,
        });

        if (!draftRes.success) {
          setErrorMessage(draftRes.error.message);
          return;
        }

        const cnId = draftRes.data.id;

        if (shouldFinalize) {
          const finalRes = await finalizeCreditNote({ id: cnId });
          if (!finalRes.success) {
            setErrorMessage(finalRes.error.message);
            return;
          }
          router.push(`/credit-notes/${cnId}`);
        } else {
          router.push(`/invoices/${originalInvoice.id}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        setErrorMessage(message);
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Top Header Actions Block */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Link
            href={`/invoices/${originalInvoice.id}`}
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-all hover:bg-accent hover:text-foreground shadow-xs cursor-pointer"
            title={`Back to Invoice ${originalInvoice.invoice_number}`}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Issue GST Credit Note
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                INV: {originalInvoice.invoice_number}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Adjust or refund items from finalized invoice{' '}
              <strong className="text-foreground font-medium">{originalInvoice.invoice_number}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            disabled={isPending || !preview.ok}
            onClick={() => handleSave(false)}
            className="h-9 px-3.5 flex items-center gap-2 text-sm font-medium shadow-xs"
          >
            <Save className="size-4 text-muted-foreground" />
            Save as Draft
          </Button>
          <Button
            type="button"
            disabled={isPending || !preview.ok}
            onClick={() => handleSave(true)}
            className="h-9 px-4 flex items-center gap-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors"
          >
            <CheckCircle className="size-4" />
            Finalize & Issue
          </Button>
        </div>
      </div>

      {displayedError && (
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3.5 text-sm text-destructive font-medium animate-shake">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <span>{displayedError}</span>
        </div>
      )}

      {/* Original Invoice Info Card */}
      <div className="rounded-xl border border-border bg-card px-4 pt-2 pb-2 shadow-xs space-y-1.5">
        <div className="flex items-center justify-between text-[13px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span>ORIGINAL INVOICE REFERENCE :</span>
            <span className="font-mono text-foreground font-semibold text-[13px]">
              {originalInvoice.invoice_number}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-[15px] text-foreground">
          <div>
            <span className="text-muted-foreground font-medium">Customer: </span>
            <span className="font-semibold text-foreground">
              {originalInvoice.customer_name || originalInvoice.billing_name || 'Cash Customer'}
            </span>
            {(originalInvoice.recipient_gstin || originalInvoice.billing_gstin) && (
              <span className="font-mono text-muted-foreground text-[13px] ml-1">
                ({originalInvoice.recipient_gstin || originalInvoice.billing_gstin})
              </span>
            )}
          </div>

          <span className="hidden sm:inline text-border">|</span>

          <div>
            <span className="text-muted-foreground font-medium">Invoice Date: </span>
            <span className="font-medium text-foreground">
              {originalInvoice.invoice_date
                ? formatIstDate(originalInvoice.invoice_date, {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : 'N/A'}
            </span>
          </div>

          <span className="hidden sm:inline text-border">|</span>

          <div>
            <span className="text-muted-foreground font-medium">Original Bill: </span>
            <span className="font-mono font-semibold text-foreground">
              {formatPaiseAsInr(originalInvoice.grand_total_paise)}
            </span>
          </div>

          <span className="hidden sm:inline text-border">|</span>

          <div>
            <span className="text-muted-foreground font-medium">Tax Region: </span>
            <span className="font-medium text-foreground">
              {isIntraState ? 'Intra-State (CGST+SGST)' : 'Inter-State (IGST)'}
            </span>
          </div>
        </div>
      </div>

      {/* Credit Note Reason & Notes (GST Rule 53) */}
      <div className="rounded-xl border border-border bg-card px-4 pt-3 pb-3 shadow-xs space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">
            Credit Note Details (GST Rule 53)
          </h2>
          <span className="text-[12px] text-muted-foreground">Mandatory for GST Compliance</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div>
            <label className="text-[13px] font-semibold text-foreground block mb-1">
              Reason for Issuing Credit Note <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as CreditNoteReasonCode)}
              className="w-full h-9 px-3 py-1.5 text-[15px] border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-colors"
            >
              {CREDIT_NOTE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-[12px] text-muted-foreground mt-[3px]">
              This statutory reason code is submitted in your monthly GSTR-1 return (Table 9B).
            </p>
          </div>

          <div>
            <label className="text-[13px] font-semibold text-foreground block mb-1">Internal Notes / Remarks</label>
            <input
              type="text"
              placeholder="e.g. 2 pens returned due to leaking ink, cash refunded"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-9 px-3 py-1.5 text-[15px] border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-xs transition-colors"
            />
            <p className="text-[12px] text-muted-foreground mt-[3px]">
              Internal reference notes recorded with this credit note.
            </p>
          </div>
        </div>
      </div>

      {/* Creditable Items Table */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="px-4 pt-2.5 pb-2.5 border-b border-border bg-muted/40">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-foreground">
            Select Items & Quantities to Credit
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Enter the quantity of each product being returned or credited. Set quantity to 0 or remove items you do not wish to credit.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[15px] text-left border-collapse">
            <thead className="bg-muted/50 text-[12px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border whitespace-nowrap">
              <tr>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-12">#</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center min-w-[240px]">Item Description</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-28">HSN/SAC</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-28">Billed Qty</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-28">Max Credit</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-32">Credit Qty</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-28">Rate (₹)</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-24">Tax (%)</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-32">Line Credit</th>
                <th className="px-3 pt-[7px] pb-[7px] text-center w-16">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lineStates.map((item, idx) => {
                const id = item.original.originalLineItemId;
                const q = quantities[id] ?? 0;
                const remMilli = remainingMilli(item);
                const remQty = milliToQuantity(remMilli);
                const lineCreditPaise = preview.ok
                  ? preview.lines.find((l) => l.originalLineItemId === id)?.lineTotalPaise ?? 0
                  : 0;
                const lineCreditRupees = lineCreditPaise / 100;
                const rateRupees = item.original.unitPricePaise / 100;
                const taxPercent = Number(item.original.taxRatePercentage);

                return (
                  <tr
                    key={id}
                    className={`transition-colors ${
                      q === 0 ? 'bg-muted/10 opacity-60 hover:opacity-100' : 'hover:bg-muted/30'
                    }`}
                  >
                    <td className="px-3 pt-[7px] pb-[7px] text-center text-muted-foreground font-medium">{idx + 1}</td>
                    <td className="px-3 pt-[7px] pb-[7px]">
                      <p className="font-semibold text-foreground">{item.original.description}</p>
                      <span className="inline-block text-[12px] text-muted-foreground font-normal mt-0.5">
                        Unit: {item.original.unitOfMeasurement}
                      </span>
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center font-mono text-[13px] text-muted-foreground">
                      {item.original.hsnSacCode || '—'}
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center text-muted-foreground font-mono">
                      {milliToQuantity(item.original.quantityMilli)}
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center font-semibold text-foreground font-mono">
                      {remQty}
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center">
                      <input
                        type="number"
                        min="0"
                        max={remQty}
                        step="0.001"
                        value={q === 0 ? '' : q}
                        placeholder="0"
                        onChange={(e) => handleQuantityChange(id, Number(e.target.value))}
                        disabled={remMilli <= 0}
                        className="w-24 h-8 px-2 py-1 mx-auto border border-border rounded-md text-center font-mono font-semibold text-[15px] focus:ring-2 focus:ring-primary focus:outline-none bg-background shadow-xs disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-right font-mono">₹{rateRupees.toFixed(2)}</td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center font-mono text-[13px]">{taxPercent}%</td>
                    <td className="px-3 pt-[7px] pb-[7px] text-right font-mono font-bold text-red-600">
                      ₹{lineCreditRupees.toFixed(2)}
                    </td>
                    <td className="px-3 pt-[7px] pb-[7px] text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveItem(id)}
                        className="size-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                        title="Remove item"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Box & Financial Impact */}
      <div className="flex flex-col lg:flex-row justify-between items-start gap-2">
        {/* Financial Impact Callout */}
        <div className="flex-1 w-full rounded-xl border border-blue-200/80 bg-blue-50/50 px-4 pt-3 pb-3 shadow-xs space-y-1.5">
          <div className="flex items-center gap-2 text-blue-700 font-bold text-[13px] uppercase tracking-wider">
            <AlertCircle className="size-4 shrink-0" />
            <span>Financial & Accounting Impact</span>
          </div>
          <div className="space-y-1">
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Finalizing this credit note will reduce the customer balance due on invoice{' '}
              <strong className="text-foreground font-semibold">{originalInvoice.invoice_number}</strong> by{' '}
              <strong className="text-red-600 font-bold">
                ₹{grandTotalRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>.
            </p>
            {previouslyCreditedPaise > 0 && (
              <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground pl-0.5">
                <CornerDownRight className="size-3.5 text-blue-600 shrink-0" />
                <span>
                  Brings total cumulative credit across all credit notes to{' '}
                  <strong className="text-foreground font-semibold">
                    {formatPaiseAsInr(totalCumulativeCreditedPaise)}
                  </strong>.
                </span>
              </div>
            )}
          </div>
          <div className="pt-1.5 border-t border-blue-200/60 flex flex-col 2xl:flex-row 2xl:items-center gap-y-1 text-[13px]">
            <div className="flex items-center">
              <div className="whitespace-nowrap">
                <span className="text-muted-foreground">Original Invoice:</span>{' '}
                <span className="font-mono font-medium text-foreground">
                  {formatPaiseAsInr(originalInvoice.grand_total_paise)}
                </span>
              </div>
              <span className="text-blue-300 px-[3px] select-none">|</span>
              <div className="whitespace-nowrap">
                <span className="text-muted-foreground">Previously Credited:</span>{' '}
                <span className="font-mono font-medium text-foreground">
                  {previouslyCreditedPaise > 0 ? `-${formatPaiseAsInr(previouslyCreditedPaise)}` : '₹0.00'}
                </span>
              </div>
            </div>

            <span className="hidden 2xl:inline text-blue-300 px-[3px] select-none">|</span>

            <div className="flex items-center">
              <div className="whitespace-nowrap">
                <span className="text-muted-foreground">This Credit Note:</span>{' '}
                <span className="font-mono font-semibold text-red-600">
                  -₹{grandTotalRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <span className="text-blue-300 px-[3px] select-none">|</span>
              <div className="whitespace-nowrap">
                <span className="text-muted-foreground">Net Adjusted Balance:</span>{' '}
                <span className="font-mono font-bold text-[14px] text-foreground">
                  {formatPaiseAsInr(netAdjustedBalancePaise)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tax Summary Breakdown Box */}
        <div className="w-full lg:w-96 rounded-xl border border-border bg-card px-4 pt-3 pb-3 shadow-xs space-y-1.5 text-[15px]">
          <div className="flex justify-between text-[13px] text-muted-foreground font-bold uppercase tracking-wider pb-1 border-b border-border">
            <span>Credit Amount Summary</span>
            <span>Values (₹)</span>
          </div>

          <div className="flex justify-between text-muted-foreground">
            <span>Taxable Credit:</span>
            <span className="font-mono font-medium text-foreground">₹{subtotalRupees.toFixed(2)}</span>
          </div>

          {isIntraState ? (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>CGST:</span>
                <span className="font-mono font-medium text-foreground">₹{cgstRupees.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>SGST:</span>
                <span className="font-mono font-medium text-foreground">₹{sgstRupees.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-muted-foreground">
              <span>IGST:</span>
              <span className="font-mono font-medium text-foreground">₹{igstRupees.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t border-border pt-1.5 flex justify-between items-baseline">
            <span className="font-bold text-foreground text-[15px]">Grand Total Credit:</span>
            <span className="font-mono font-bold text-xl text-red-600">
              ₹{grandTotalRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
