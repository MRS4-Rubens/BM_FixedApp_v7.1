/**
 * MONEY-02: what the finalized invoice says about the buyer.
 *
 * The GSTIN on the draft is what the user typed and saw on the preview, so it is authoritative (the same rule COMP-003
 * applies to Place of Supply). The invoice form lets the GSTIN be edited while a saved customer stays linked; the NAME
 * cannot be (editing it unlinks the customer), so a linked customer still supplies the name and the address, exactly
 * as before and as the preview shows. Before this rule, finalize silently replaced the GSTIN with the customer
 * record's value (possibly empty), so the issued invoice differed from the preview and GSTR-1 could file a B2B sale
 * as B2CS.
 */
export interface DraftBuyerFields {
  readonly billing_name_snapshot: string | null;
  readonly billing_gstin_snapshot: string | null;
  readonly billing_address_snapshot: string | null;
}

export interface CustomerBuyerFields {
  readonly name: string;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly city: string | null;
  readonly state_code: string | null;
  readonly pincode: string | null;
}

export interface BuyerSnapshot {
  readonly billingName: string | null;
  readonly billingGstin: string | null;
  readonly billingAddress: string | null;
}

/** Upper-case, trimmed; empty means "no GSTIN" (unregistered buyer). */
export function normalizeBuyerGstin(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

function formatCustomerAddress(customer: CustomerBuyerFields): string {
  const cityStatePincode = [customer.city, customer.state_code, customer.pincode].filter(Boolean).join(', ');
  return [customer.address_line1, customer.address_line2, cityStatePincode].filter(Boolean).join('\n');
}

export function resolveBuyerSnapshot(draft: DraftBuyerFields, customer: CustomerBuyerFields | null): BuyerSnapshot {
  if (customer === null) {
    return {
      billingName: draft.billing_name_snapshot,
      billingGstin: normalizeBuyerGstin(draft.billing_gstin_snapshot),
      billingAddress: draft.billing_address_snapshot,
    };
  }
  return {
    billingName: customer.name,
    billingGstin: normalizeBuyerGstin(draft.billing_gstin_snapshot),
    billingAddress: formatCustomerAddress(customer),
  };
}
