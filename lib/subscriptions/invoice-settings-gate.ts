import { canUseTemplate, getPlanEntitlements, type BusinessSubscriptionSource } from '@/lib/subscriptions/entitlements';

/** Number formats every plan may use (identical to the list currently hard-coded in save-invoice-settings.ts). */
export const FREE_PLAN_INVOICE_NUMBER_FORMATS: readonly string[] = ['BMA/{FY}/{SEQ:4}', 'INV-{DD}/{MM}/{YY}/{SEQ:3}'];

export interface InvoiceSettingsRequest {
  invoice_number_format?: string | null;
  default_invoice_template?: string | null;
}
export type InvoiceSettingsGateResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export function checkInvoiceSettingsEntitlement(
  subscription: BusinessSubscriptionSource,
  currentInvoiceNumberFormat: string | null,
  requested: InvoiceSettingsRequest,
): InvoiceSettingsGateResult {
  const { canCustomizeInvoiceFormat } = getPlanEntitlements(subscription);
  const requestedFormat = requested.invoice_number_format;
  if (
    !canCustomizeInvoiceFormat &&
    requestedFormat !== undefined && requestedFormat !== null &&
    requestedFormat !== currentInvoiceNumberFormat &&
    !FREE_PLAN_INVOICE_NUMBER_FORMATS.some((format) => format === requestedFormat)
  ) {
    return {
      allowed: false,
      code: 'INVOICE_FORMAT_LOCKED',
      message: 'Custom invoice numbering formats and brand prefixes are exclusive to paid plans. Upgrade to Essentials Pro to customize your invoice format.',
    };
  }
  const requestedTemplate = requested.default_invoice_template;
  if (requestedTemplate !== undefined && requestedTemplate !== null) {
    const check = canUseTemplate(subscription, requestedTemplate);
    if (!check.allowed) {
      return {
        allowed: false,
        code: check.code ?? 'PLAN_LIMIT_REACHED',
        message: check.reason ?? 'Your current plan only supports the Classic (Template 1) layout. Please upgrade to unlock premium invoice templates.',
      };
    }
  }
  return { allowed: true };
}

