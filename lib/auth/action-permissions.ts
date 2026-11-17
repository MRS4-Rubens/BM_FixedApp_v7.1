export type ActionAccess =
  | 'owner' // createAuthenticatedAction(..., { roles: OWNER_ONLY })
  | 'editor' // owner or staff: changes business data; { roles: EDITOR_ROLES } (the read-only accountant is refused)
  | 'any-member' // ANY role of the business, including the read-only accountant: must only READ; no `roles` option
  | 'platform-admin' // { requirePlatformAdmin: true }; independent of business roles
  | 'owner-or-platform-admin' // in-handler check using evaluateRoleAccess + isPlatformAdmin (no `roles` option)
  | 'signed-in' // any signed-in account, even one WITHOUT a business yet; no `roles` option (handler enforces its own rules)
  | 'self' // any role, but reads/writes ONLY the caller's own rows (WHERE user_id/id = context.appUser.id); no `roles` option
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
  // Team members (feature A): the owner manages the team; anyone signed in can accept an invite sent to them
  'get-team': 'owner',
  'invite-team-member': 'owner',
  'resend-team-invite': 'owner',
  'revoke-team-invite': 'owner',
  'remove-team-member': 'owner',
  'change-team-member-role': 'owner',
  'accept-team-invite': 'signed-in',
  // Notifications (feature C): each person's own bell items and e-mail choices; the GST frequency is a business setting
  'mark-notifications-read': 'self',
  'get-notification-settings': 'self',
  'save-notification-preferences': 'self',
  'save-gst-filing-frequency': 'owner',

  // Platform administration (AUTH-001)
  'admin-update-business-identity': 'platform-admin',
  'get-admin-dashboard-stats': 'platform-admin',
  'get-all-businesses': 'platform-admin',
  'get-all-users': 'platform-admin',
  'get-pending-requests': 'platform-admin',
  'get-claim-screenshot-url': 'platform-admin',
  'process-subscription-claim': 'platform-admin',
  'update-business-subscription': 'platform-admin',
  'update-platform-payee': 'platform-admin',

  // Public
  'list-tax-rates': 'public',

  // Day-to-day operations. Feature B: 'editor' = owner or staff (changes data); 'any-member' = every role,
  // including the read-only accountant (CA), so it must only read.
  'save-invoice-draft': 'editor',
  'delete-invoice-draft': 'editor',
  'finalize-invoice': 'editor',
  'get-invoice': 'any-member',
  'list-invoices': 'any-member',
  'get-next-sequence': 'any-member',
  'get-archived-pdf-url': 'any-member',
  'email-invoice': 'editor',
  'send-payment-reminder': 'editor',
  'record-payment': 'editor',
  'list-payments': 'any-member',
  'save-credit-note-draft': 'editor',
  'delete-credit-note-draft': 'editor',
  'get-credit-note': 'any-member',
  'list-credit-notes': 'any-member',
  'get-credit-note-form-data': 'any-member',
  'get-archived-credit-note-pdf-url': 'any-member',
  'create-customer': 'editor',
  'update-customer': 'editor',
  'deactivate-customer': 'editor',
  'reactivate-customer': 'editor',
  'list-customers': 'any-member',
  'search-customer-options': 'any-member',
  'create-product': 'editor',
  'update-product': 'editor',
  'deactivate-product': 'editor',
  'reactivate-product': 'editor',
  'list-products': 'any-member',
  'search-product-options': 'any-member',
  // Feature D: bulk import (Professional). Checking is part of importing, so both are editor-only.
  'check-bulk-import': 'editor',
  'run-bulk-import': 'editor',
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

