export type ActionAccess =
  | 'owner' // createAuthenticatedAction(..., { roles: OWNER_ONLY })
  | 'any-member' // any role of the business; no `roles` option
  | 'platform-admin' // { requirePlatformAdmin: true }; independent of business roles
  | 'owner-or-platform-admin' // in-handler check using evaluateRoleAccess + isPlatformAdmin (no `roles` option)
  | 'public'; // createAction (unauthenticated)

/** Keyed by the action's scope name (3rd argument of createAuthenticatedAction / createAction). */
export const ACTION_ACCESS = {
  // Business identity & settings: owner only
  'save-business-profile': 'owner',
  'upload-business-logo': 'owner',
  'remove-business-logo': 'owner',
  'upload-business-signature': 'owner',
  'remove-business-signature': 'owner',
  'save-invoice-settings': 'owner',
  'import-legacy-display-prefs': 'owner',
  'request-account-closure': 'owner',
  // Destructive / statutory reversals: owner only
  'void-payment': 'owner',
  'void-credit-note': 'owner',
  // Tax-reducing statutory document finalization: owner only (segregation of duties; flip to 'any-member' to relax)
  'finalize-credit-note': 'owner',
  // Billing: owner only
  'submit-payment-claim': 'owner',
  'get-business-subscriptions': 'owner-or-platform-admin',

  // Platform administration (AUTH-001)
  'admin-update-business-identity': 'platform-admin',
  'get-admin-dashboard-stats': 'platform-admin',
  'get-all-businesses': 'platform-admin',
  'get-all-users': 'platform-admin',
  'get-pending-requests': 'platform-admin',
  'get-claim-screenshot-url': 'platform-admin',
  'process-subscription-claim': 'platform-admin',
  'update-business-subscription': 'platform-admin',

  // Public
  'list-tax-rates': 'public',

  // Day-to-day operations: any member (owner or staff)
  'save-invoice-draft': 'any-member',
  'delete-invoice-draft': 'any-member',
  'finalize-invoice': 'any-member',
  'get-invoice': 'any-member',
  'list-invoices': 'any-member',
  'get-next-sequence': 'any-member',
  'get-archived-pdf-url': 'any-member',
  'email-invoice': 'any-member',
  'send-payment-reminder': 'any-member',
  'record-payment': 'any-member',
  'list-payments': 'any-member',
  'save-credit-note-draft': 'any-member',
  'delete-credit-note-draft': 'any-member',
  'get-credit-note': 'any-member',
  'list-credit-notes': 'any-member',
  'get-credit-note-form-data': 'any-member',
  'get-archived-credit-note-pdf-url': 'any-member',
  'create-customer': 'any-member',
  'update-customer': 'any-member',
  'deactivate-customer': 'any-member',
  'reactivate-customer': 'any-member',
  'list-customers': 'any-member',
  'search-customer-options': 'any-member',
  'create-product': 'any-member',
  'update-product': 'any-member',
  'deactivate-product': 'any-member',
  'reactivate-product': 'any-member',
  'list-products': 'any-member',
  'search-product-options': 'any-member',
  'send-feedback': 'any-member',
  // Reports (read): any member
  'get-dashboard-stats': 'any-member',
  'get-export-data': 'any-member',
  'get-gstr1-data': 'any-member',
  'get-itr-data': 'any-member',
  'get-recent-invoices': 'any-member',
  'get-sales-by-financial-year': 'any-member',
  'get-sales-by-period': 'any-member',
  'get-top-customers': 'any-member',
  'get-top-products': 'any-member',
} as const satisfies Record<string, ActionAccess>;

export type ActionScope = keyof typeof ACTION_ACCESS;

